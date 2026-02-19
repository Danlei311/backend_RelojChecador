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

        // 1️⃣ Insertar horario
        const [resultHorario] = await connection.query(
            `
            INSERT INTO horarios 
            (horaEntrada, horaSalida, toleranciaMinutos, tipoHorario, estatus)
            VALUES (?, ?, ?, ?, TRUE)
            `,
            [horaEntrada, horaSalida, toleranciaMinutos || 0, tipoHorario]
        );

        const idHorario = resultHorario.insertId;

        // 2️⃣ Insertar días
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

        // 3️⃣ Relación propiedad_area_horario (SIN FECHAS)
        await connection.query(
            `
            INSERT INTO propiedad_area_horario
            (idPropiedadArea, idHorario, estatus)
            VALUES (?, ?, TRUE)
            `,
            [idPropiedadArea, idHorario]
        );

        // 4️⃣ Auditoría
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

        const [rows] = await db.query(
            `
            SELECT 
            h.idHorario,
            h.horaEntrada,
            h.horaSalida,
            h.toleranciaMinutos,
            h.estatus,
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
        ORDER BY p.nombre ASC, a.nombreArea ASC;
            `
        );

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
        }

        query += ` ORDER BY p.nombre, a.nombreArea`;

        const [rows] = idHorarioEditar
            ? await db.query(query, [idHorarioEditar])
            : await db.query(query);

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

        const [rows] = await db.query(`
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.tipoHorario,
                h.estatus,
                pah.idPropiedadArea
            FROM horarios h
            INNER JOIN propiedad_area_horario pah 
                ON pah.idHorario = h.idHorario
            WHERE h.idHorario = ?
            LIMIT 1
        `, [id]);

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

        // 1️⃣ Verificar existencia
        const [existe] = await connection.query(
            "SELECT * FROM horarios WHERE idHorario = ?",
            [id]
        );

        if (existe.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Horario no encontrado"
            });
        }

        // 2️⃣ Actualizar datos principales
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
            toleranciaMinutos,
            tipoHorario,
            id
        ]);

        // 3️⃣ Actualizar relación propiedad_area_horario
        await connection.query(`
            UPDATE propiedad_area_horario
            SET idPropiedadArea = ?
            WHERE idHorario = ?
        `, [
            idPropiedadArea,
            id
        ]);

        // 4️⃣ Actualizar días
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

        // 5️⃣ Auditoría
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

        // 6️⃣ Obtener datos completos para SSE
        const [nuevoHorario] = await db.query(`
            SELECT 
                h.idHorario,
                h.horaEntrada,
                h.horaSalida,
                h.toleranciaMinutos,
                h.tipoHorario,
                h.estatus,
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

        // 1️⃣ Verificar que exista
        const [horario] = await connection.query(
            "SELECT * FROM horarios WHERE idHorario = ?",
            [id]
        );

        if (horario.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Horario no encontrado"
            });
        }

        // 2️⃣ Obtener propiedad y área relacionadas
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

        // 3️⃣ Desvincular empleados (quedan sin asignación)
        await connection.query(
            "UPDATE empleados SET idPropiedadArea = NULL WHERE idPropiedadArea = ?",
            [idPropiedadArea]
        );

        // 4️⃣ Desactivar relación propiedad_area_horario
        await connection.query(
            "UPDATE propiedad_area_horario SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );

        // 5️⃣ Desactivar horario
        await connection.query(
            "UPDATE horarios SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );

        // 5.5️⃣ Desactivar días del horario
        await connection.query(
            "UPDATE horario_dias SET estatus = FALSE WHERE idHorario = ?",
            [id]
        );


        // 6️⃣ Auditoría
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

        // 7️⃣ Notificar SSE
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
