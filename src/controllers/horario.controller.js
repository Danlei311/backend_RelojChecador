import { db } from "../config/database.js";
import { notificarCambioHorarios } from "../sse/horarios.sse.js";

// CREAR HORARIO
export const crearHorario = async (req, res) => {

    const {
        horaEntrada,
        horaSalida,
        toleranciaMinutos,
        tipoHorario,
        idPropiedadArea,
        dias
    } = req.body;

    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!horaEntrada || !horaSalida || !idPropiedadArea || !dias || dias.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Datos incompletos"
            });
        }

        await connection.beginTransaction();

        // Validación de propiedad
        const [infoPropiedad] = await connection.query(`
            SELECT p.idPropiedad
            FROM propiedad_area pa
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE pa.idPropiedadArea = ?
        `, [idPropiedadArea]);

        if (infoPropiedad.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Área no encontrada"
            });
        }

        const propiedadDelArea = infoPropiedad[0].idPropiedad;

        // LECTURA no puede crear
        if (usuario.rol === "LECTURA") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para crear horarios"
            });
        }

        // ADMIN_PROPIEDAD solo su propiedad
        if (usuario.rol === "ADMIN_PROPIEDAD" && propiedadDelArea != usuario.idPropiedad) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No puedes crear horarios en otra propiedad"
            });
        }

        // Insertar horario
        const [resultHorario] = await connection.query(
            `
            INSERT INTO horarios 
            (horaEntrada, horaSalida, toleranciaMinutos, tipoHorario, estatus)
            VALUES (?, ?, ?, ?, TRUE)
            `,
            [horaEntrada, horaSalida, toleranciaMinutos || 0, tipoHorario]
        );

        const idHorario = resultHorario.insertId;

        // Insertar días
        for (const dia of dias) {
            await connection.query(
                `
                INSERT INTO horario_dias 
                (idHorario, diaSemana, estatus)
                VALUES (?, ?, TRUE)
                `,
                [idHorario, dia]
            );
        }

        // Relación propiedad_area_horario (SIN FECHAS)
        await connection.query(
            `
            INSERT INTO propiedad_area_horario
            (idPropiedadArea, idHorario, estatus)
            VALUES (?, ?, TRUE)
            `,
            [idPropiedadArea, idHorario]
        );

        // Auditoría
        const [infoArea] = await connection.query(`
            SELECT 
                p.nombre AS nombrePropiedad,
                a.nombreArea
            FROM propiedad_area pa
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a ON a.idArea = pa.idArea
            WHERE pa.idPropiedadArea = ?
        `, [idPropiedadArea]);

        const diasTexto = dias.join(", ");

        const mensajeAuditoria = `${usuario.usuario} creó un horario para ${infoArea[0].nombrePropiedad} - ${infoArea[0].nombreArea}. Nuevo horario: ${horaEntrada} a ${horaSalida}, tolerancia ${toleranciaMinutos || 0} min, tipo ${tipoHorario}, días: ${diasTexto}.`;

        await connection.query(
            `
            INSERT INTO auditoria 
            (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                mensajeAuditoria
            ]
        );

        await connection.commit();

        const [nuevoHorario] = await db.query(`
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.estatus,
                p.idPropiedad,
                p.nombre AS nombrePropiedad,
                a.nombreArea,
                pah.idPropiedadArea
            FROM horarios h
            INNER JOIN propiedad_area_horario pah 
                ON pah.idHorario = h.idHorario
            INNER JOIN propiedad_area pa 
                ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a 
                ON a.idArea = pa.idArea
            WHERE h.idHorario = ?
        `, [idHorario]);

        const [diasRows] = await db.query(`
            SELECT diaSemana
            FROM horario_dias
            WHERE idHorario = ? AND estatus = TRUE
        `, [idHorario]);

        nuevoHorario[0].dias = diasRows.map(d => d.diaSemana);


        notificarCambioHorarios("horario-creado", nuevoHorario[0]);

        res.status(201).json({
            success: true,
            idHorario
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        connection.release();
    }
};


export const obtenerHorariosActivos = async (req, res) => {

    try {

        let query = `
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.estatus,
                p.idPropiedad,
                p.nombre AS nombrePropiedad,
                a.nombreArea,
                pah.idPropiedadArea
            FROM horarios h
            INNER JOIN propiedad_area_horario pah 
                ON pah.idHorario = h.idHorario
                AND pah.estatus = TRUE
            INNER JOIN propiedad_area pa 
                ON pa.idPropiedadArea = pah.idPropiedadArea
                AND pa.estatus = TRUE
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
                AND p.estatus = TRUE
            INNER JOIN areas a 
                ON a.idArea = pa.idArea
                AND a.estatus = TRUE
            WHERE h.estatus = TRUE
        `;

        let params = [];

        if (req.usuario.rol === "ADMIN_PROPIEDAD" || req.usuario.rol === "LECTURA") {
            query += " AND p.idPropiedad = ?";
            params.push(req.usuario.idPropiedad);
        }

        // FILTRO MANUAL POR PROPIEDAD (solo para ADMIN)
        if (req.query.idPropiedad && req.usuario.rol === "ADMIN") {
            query += " AND p.idPropiedad = ?";
            params.push(req.query.idPropiedad);
        }

        query += " ORDER BY p.nombre ASC, a.nombreArea ASC";

        const [rows] = await db.query(query, params);


        for (const row of rows) {

            const [dias] = await db.query(`
            SELECT diaSemana
            FROM horario_dias
            WHERE idHorario = ? AND estatus = TRUE
        `, [row.idHorario]);

            row.dias = dias.map(d => d.diaSemana);
        }


        res.status(200).json({
            success: true,
            total: rows.length,
            data: rows
        });


    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};

// OBTENER AREAS SIN HORARIO ASIGNADO
export const obtenerAreasDisponiblesParaHorario = async (req, res) => {
    try {

        const usuario = req.usuario;
        const { idHorarioEditar } = req.query;

        let query = `
            SELECT 
                pa.idPropiedadArea,
                a.nombreArea,
                p.nombre AS nombrePropiedad
            FROM propiedad_area pa
            INNER JOIN areas a 
                ON a.idArea = pa.idArea
                AND a.estatus = TRUE
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
                AND p.estatus = TRUE
            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = TRUE
            WHERE pa.estatus = TRUE
        `;

        const params = [];

        // FILTRO POR PROPIEDAD (si no es ADMIN)
        if (usuario.rol !== "ADMIN") {
            query += ` AND p.idPropiedad = ? `;
            params.push(usuario.idPropiedad);
        }

        // MODO CREAR
        if (!idHorarioEditar) {
            query += `
                AND pah.idPropiedadArea IS NULL
            `;
        }

        // MODO EDITAR
        else {
            query += `
                AND (
                    pah.idPropiedadArea IS NULL
                    OR pah.idHorario = ?
                )
            `;
            params.push(idHorarioEditar);
        }

        query += ` ORDER BY p.nombre, a.nombreArea`;

        const [rows] = await db.query(query, params);

        res.status(200).json({
            success: true,
            data: rows
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};

export const obtenerHorarioPorId = async (req, res) => {
    const { id } = req.params;

    try {

        let query = `
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.tipoHorario,
                h.estatus,
                p.idPropiedad,
                pah.idPropiedadArea
            FROM horarios h
            INNER JOIN propiedad_area_horario pah 
                ON pah.idHorario = h.idHorario
            INNER JOIN propiedad_area pa
                ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p
                ON p.idPropiedad = pa.idPropiedad
            WHERE h.idHorario = ?
        `;

        let params = [id];

        if (req.usuario.rol === "ADMIN_PROPIEDAD" || req.usuario.rol === "LECTURA") {
            query += " AND p.idPropiedad = ?";
            params.push(req.usuario.idPropiedad);
        }

        query += " LIMIT 1";

        const [rows] = await db.query(query, params);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Horario no encontrado"
            });
        }

        const [dias] = await db.query(`
            SELECT diaSemana 
            FROM horario_dias
            WHERE idHorario = ? AND estatus = 1
        `, [id]);

        rows[0].dias = dias.map(d => d.diaSemana);

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};



export const actualizarHorario = async (req, res) => {
    const { id } = req.params;
    const {
        horaEntrada,
        horaSalida,
        toleranciaMinutos,
        tipoHorario,
        idPropiedadArea,
        dias
    } = req.body;

    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!horaEntrada || !horaSalida || !idPropiedadArea || !dias || dias.length === 0) {
            return res.status(400).json({
                success: false,
                message: "Datos incompletos"
            });
        }

        await connection.beginTransaction();

        // Verificar existencia
        const [infoPropiedad] = await connection.query(`
            SELECT p.idPropiedad
            FROM propiedad_area_horario pah
            INNER JOIN propiedad_area pa ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE pah.idHorario = ?
        `, [id]);

        if (infoPropiedad.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Horario no encontrado"
            });
        }

        const propiedadDelHorario = infoPropiedad[0].idPropiedad;

        // Validación de permisos
        if (usuario.rol === "LECTURA") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para actualizar horarios"
            });
        }

        if (usuario.rol === "ADMIN_PROPIEDAD" && propiedadDelHorario != usuario.idPropiedad) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No puedes modificar horarios de otra propiedad"
            });
        }

        // Actualizar datos principales
        await connection.query(`
            UPDATE horarios
            SET horaEntrada = ?,
                horaSalida = ?,
                toleranciaMinutos = ?,
                tipoHorario = ?
            WHERE idHorario = ?
        `, [
            horaEntrada,
            horaSalida,
            toleranciaMinutos || 0,
            tipoHorario,
            id
        ]);

        // Actualizar relación propiedad_area_horario
        await connection.query(`
            UPDATE propiedad_area_horario
            SET idPropiedadArea = ?
            WHERE idHorario = ?
        `, [
            idPropiedadArea,
            id
        ]);

        // Actualizar días
        await connection.query(`
            DELETE FROM horario_dias
            WHERE idHorario = ?
        `, [id]);

        for (const dia of dias) {
            await connection.query(`
                INSERT INTO horario_dias (idHorario, diaSemana, estatus)
                VALUES (?, ?, TRUE)
            `, [id, dia]);
        }

        // Auditoría
        const [infoArea] = await connection.query(`
            SELECT 
                p.nombre AS nombrePropiedad,
                a.nombreArea
            FROM propiedad_area pa
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a ON a.idArea = pa.idArea
            WHERE pa.idPropiedadArea = ?
        `, [idPropiedadArea]);

        const diasTexto = dias.join(", ");

        const mensajeAuditoria = `${usuario.usuario} actualizó el horario ID ${id} en ${infoArea[0].nombrePropiedad} - ${infoArea[0].nombreArea}. Nuevo horario: ${horaEntrada} a ${horaSalida}, tolerancia ${toleranciaMinutos} min, tipo ${tipoHorario}, días: ${diasTexto}.`;

        await connection.query(`
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
        `, [
            usuario.idUsuario,
            mensajeAuditoria
        ]);


        await connection.commit();

        // Obtener datos completos para SSE
        const [nuevoHorario] = await db.query(`
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.tipoHorario,
                h.estatus,
                p.idPropiedad,
                p.nombre AS nombrePropiedad,
                a.nombreArea
            FROM horarios h
            INNER JOIN propiedad_area_horario pah 
                ON pah.idHorario = h.idHorario
            INNER JOIN propiedad_area pa 
                ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a 
                ON a.idArea = pa.idArea
            WHERE h.idHorario = ?
        `, [id]);

        const [diasRows] = await db.query(`
            SELECT diaSemana
            FROM horario_dias
            WHERE idHorario = ? AND estatus = TRUE
        `, [id]);

        nuevoHorario[0].dias = diasRows.map(d => d.diaSemana);

        notificarCambioHorarios("horario-actualizado", nuevoHorario[0]);

        res.status(200).json({ success: true });

    } catch (error) {

        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false });

    } finally {
        connection.release();
    }
};

// ELIMINACIÓN LÓGICA DE HORARIO
export const eliminarHorario = async (req, res) => {
    const { id } = req.params;
    const usuario = req.usuario;

    const connection = await db.getConnection();

    try {

        await connection.beginTransaction();

        // Verificar que exista
        const [propiedadCheck] = await connection.query(`
            SELECT p.idPropiedad
            FROM propiedad_area_horario pah
            INNER JOIN propiedad_area pa ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE pah.idHorario = ?
        `, [id]);

        if (propiedadCheck.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Horario no encontrado"
            });
        }

        const propiedadDelHorario = propiedadCheck[0].idPropiedad;

        if (usuario.rol === "LECTURA") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para eliminar horarios"
            });
        }

        if (usuario.rol === "ADMIN_PROPIEDAD" && propiedadDelHorario != usuario.idPropiedad) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No puedes eliminar horarios de otra propiedad"
            });
        }

        // Obtener propiedad y área relacionadas
        const [info] = await connection.query(`
            SELECT 
                pa.idPropiedadArea,
                p.nombre AS nombrePropiedad,
                a.nombreArea
            FROM propiedad_area_horario pah
            INNER JOIN propiedad_area pa 
                ON pa.idPropiedadArea = pah.idPropiedadArea
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a 
                ON a.idArea = pa.idArea
            WHERE pah.idHorario = ?
            AND pah.estatus = TRUE
        `, [id]);

        if (info.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "El horario ya está desactivado"
            });
        }

        const idPropiedadArea = info[0].idPropiedadArea;

        // Desvincular empleados (quedan sin asignación)
        await connection.query(
            "UPDATE empleados SET idPropiedadArea = NULL WHERE idPropiedadArea = ?",
            [idPropiedadArea]
        );

        // Desactivar relación propiedad_area_horario
        await connection.query(
            "UPDATE propiedad_area_horario SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );

        // Desactivar horario
        await connection.query(
            "UPDATE horarios SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );

        // Desactivar días del horario
        await connection.query(
            "UPDATE horario_dias SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );


        // Auditoría
        const mensajeAuditoria =
            `${usuario.usuario} desactivó el horario ID ${id} ` +
            `en ${info[0].nombrePropiedad} - ${info[0].nombreArea}. ` +
            `Los empleados fueron desvinculados del área.`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                mensajeAuditoria
            ]
        );

        await connection.commit();

        // Notificar SSE
        notificarCambioHorarios("horario-eliminado", {
            idHorario: parseInt(id),
            estatus: 0
        });

        res.status(200).json({ success: true });

    } catch (error) {

        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false });

    } finally {
        connection.release();
    }
};
