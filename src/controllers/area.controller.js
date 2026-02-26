import { db } from "../config/database.js";
import { notificarCambioAreas } from "../sse/areas.sse.js";

// CREAR ÁREA
export const crearArea = async (req, res) => {
    const { nombreArea, descripcion, idPropiedad } = req.body;
    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!nombreArea || !idPropiedad) {
            return res.status(400).json({
                success: false,
                message: "Nombre del área y propiedad son obligatorios"
            });
        }

        // Validación de permisos
        if (usuario.rol === "LECTURA") {
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para crear áreas"
            });
        }

        if (usuario.rol === "ADMIN_PROPIEDAD" && idPropiedad != usuario.idPropiedad) {
            return res.status(403).json({
                success: false,
                message: "No puedes crear áreas en otra propiedad"
            });
        }

        await connection.beginTransaction();

        // 1️⃣ Insertar área
        const [result] = await connection.query(
            `
            INSERT INTO areas (nombreArea, descripcion, estatus)
            VALUES (?, ?, TRUE)
            `,
            [nombreArea, descripcion || null]
        );

        const idArea = result.insertId;

        // 2️⃣ Insertar relación propiedad_area
        await connection.query(
            `
            INSERT INTO propiedad_area (idPropiedad, idArea, estatus)
            VALUES (?, ?, TRUE)
            `,
            [idPropiedad, idArea]
        );

        // Obtener nombre de propiedad
        const [propiedad] = await connection.query(
            "SELECT nombre FROM propiedades WHERE idPropiedad = ?",
            [idPropiedad]
        );

        const nombrePropiedad = propiedad[0]?.nombre || "";


        // 3️⃣ Auditoría
        const accion = `${usuario.usuario} creó el área "${nombreArea}" en propiedad ID ${idPropiedad}`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [usuario.idUsuario, accion]
        );

        await connection.commit();

        notificarCambioAreas("area-creada", {
            idArea,
            nombreArea,
            descripcion,
            idPropiedad,
            nombrePropiedad,
            estatus: 1
        });


        res.status(201).json({
            success: true,
            idArea
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        connection.release();
    }
};


// OBTENER ÁREAS ACTIVAS
export const obtenerAreasActivas = async (req, res) => {
    try {

        const { idPropiedad } = req.query; // 👈 NUEVO

        let query = `
            SELECT 
                a.idArea,
                a.nombreArea,
                a.descripcion,
                a.estatus,
                p.idPropiedad,
                p.nombre AS nombrePropiedad
            FROM areas a
            INNER JOIN propiedad_area pa ON pa.idArea = a.idArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE a.estatus = TRUE
              AND pa.estatus = TRUE
              AND p.estatus = TRUE
        `;

        let params = [];

        // ADMIN_PROPIEDAD y LECTURA
        if (req.usuario.rol === "ADMIN_PROPIEDAD" || req.usuario.rol === "LECTURA") {
            query += " AND p.idPropiedad = ?";
            params.push(req.usuario.idPropiedad);
        }

        // FILTRO PARA ADMIN
        if (req.usuario.rol === "ADMIN" && idPropiedad && idPropiedad !== "0") {
            query += " AND p.idPropiedad = ?";
            params.push(idPropiedad);
        }

        query += " ORDER BY p.nombre ASC, a.nombreArea ASC";

        const [areas] = await db.query(query, params);

        res.status(200).json({
            success: true,
            total: areas.length,
            data: areas
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};


// OBTENER POR ID
export const obtenerAreaPorId = async (req, res) => {
    const { id } = req.params;

    try {

        let query = `
            SELECT 
                a.idArea,
                a.nombreArea,
                a.descripcion,
                a.estatus,
                p.idPropiedad,
                p.nombre AS nombrePropiedad,
                pa.idPropiedadArea
            FROM areas a
            INNER JOIN propiedad_area pa 
                ON pa.idArea = a.idArea
            INNER JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad
            WHERE a.idArea = ?
        `;

        let params = [id];

        //FILTRO POR PROPIEDAD
        if (req.usuario.rol === "ADMIN_PROPIEDAD") {
            query += " AND p.idPropiedad = ?";
            params.push(req.usuario.idPropiedad);
        }

        query += " LIMIT 1";

        const [rows] = await db.query(query, params);

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Área no encontrada"
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false });
    }
};


// ACTUALIZAR
export const actualizarArea = async (req, res) => {
    const { id } = req.params;
    const { nombreArea, descripcion, idPropiedad } = req.body;
    const usuario = req.usuario;

    const connection = await db.getConnection();

    try {

        if (!nombreArea || !idPropiedad) {
            return res.status(400).json({
                success: false,
                message: "Nombre y propiedad son obligatorios"
            });
        }

        await connection.beginTransaction();

        // Verificar existencia
        const [existe] = await connection.query(
            `
            SELECT p.idPropiedad
            FROM areas a
            INNER JOIN propiedad_area pa ON pa.idArea = a.idArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE a.idArea = ?
            `,
            [id]
        );

        if (existe.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Área no encontrada"
            });
        }

        const propiedadDelArea = existe[0].idPropiedad;
        // Validaciones
        if (usuario.rol === "LECTURA") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para actualizar áreas"
            });
        }

        if (usuario.rol === "ADMIN_PROPIEDAD" && propiedadDelArea != usuario.idPropiedad) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No puedes modificar áreas de otra propiedad"
            });
        }

        // Actualizar datos básicos
        await connection.query(
            `
            UPDATE areas
            SET nombreArea = ?, descripcion = ?
            WHERE idArea = ?
            `,
            [nombreArea, descripcion || null, id]
        );

        // Actualizar relación propiedad_area
        await connection.query(
            `
            UPDATE propiedad_area
            SET idPropiedad = ?
            WHERE idArea = ?
            `,
            [idPropiedad, id]
        );

        // Auditoría
        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                `${usuario.usuario} actualizó el área "${nombreArea}" (ID: ${id})`
            ]
        );

        await connection.commit();

        // Obtener nombre propiedad para SSE
        const [prop] = await db.query(
            "SELECT nombre FROM propiedades WHERE idPropiedad = ?",
            [idPropiedad]
        );

        notificarCambioAreas("area-actualizada", {
            idArea: parseInt(id),
            nombreArea,
            descripcion,
            idPropiedad,
            nombrePropiedad: prop[0]?.nombre || "",
            estatus: 1
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

// ELIMINACIÓN LÓGICA
export const eliminarArea = async (req, res) => {
    const { id } = req.params;
    const usuario = req.usuario;

    const connection = await db.getConnection();

    try {

        await connection.beginTransaction();



        // Obtener idPropiedadArea
        const [areaInfo] = await connection.query(
            `
            SELECT 
                pa.idPropiedadArea,
                p.idPropiedad
            FROM areas a
            INNER JOIN propiedad_area pa ON pa.idArea = a.idArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE a.idArea = ?
            `,
            [id]
        );

        if (areaInfo.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Área no encontrada"
            });
        }

        const idPropiedadArea = areaInfo[0].idPropiedadArea;
        const propiedadDelArea = areaInfo[0].idPropiedad;

        // Validaciones
        if (usuario.rol === "LECTURA") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No tienes permisos para eliminar áreas"
            });
        }

        if (usuario.rol === "ADMIN_PROPIEDAD" && propiedadDelArea != usuario.idPropiedad) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "No puedes eliminar áreas de otra propiedad"
            });
        }


        // 1️⃣ Desvincular empleados
        await connection.query(
            "UPDATE empleados SET idPropiedadArea = NULL WHERE idPropiedadArea = ?",
            [idPropiedadArea]
        );

        // 2️⃣ Desactivar horarios
        await connection.query(
            "UPDATE propiedad_area_horario SET estatus = FALSE WHERE idPropiedadArea = ?",
            [idPropiedadArea]
        );

        // 3️⃣ Desactivar relación propiedad_area
        await connection.query(
            "UPDATE propiedad_area SET estatus = FALSE WHERE idPropiedadArea = ?",
            [idPropiedadArea]
        );

        // 4️⃣ Desactivar área
        await connection.query(
            "UPDATE areas SET estatus = FALSE WHERE idArea = ?",
            [id]
        );

        // 2.5️⃣ Desactivar horarios dependientes
        await connection.query(`
            UPDATE horarios 
            SET estatus = FALSE
            WHERE idHorario IN (
                SELECT idHorario
                FROM propiedad_area_horario
                WHERE idPropiedadArea = ?
            )
        `, [idPropiedadArea]);

        // 2.6️⃣ Desactivar días del horario
        await connection.query(`
            UPDATE horario_dias
            SET estatus = FALSE
            WHERE idHorario IN (
                SELECT idHorario
                FROM propiedad_area_horario
                WHERE idPropiedadArea = ?
            )
        `, [idPropiedadArea]);

        // Auditoría
        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                `${usuario.usuario} eliminó el área (ID: ${id}). Empleados conservados.`
            ]
        );

        await connection.commit();

        notificarCambioAreas("area-eliminada", {
            idArea: parseInt(id),
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
