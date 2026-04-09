import { db } from "../config/database.js";
import { notificarCambioPropiedades } from "../sse/propiedad.sse.js";


// ?POST: Crear nueva propiedad (solo ADMIN)
export const crearPropiedad = async (req, res) => {
    const { nombre, direccion } = req.body;
    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {
        if (!nombre || !direccion) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Nombre y dirección son obligatorios"
            });
        }

        await connection.beginTransaction();

        const [result] = await connection.query(
            `
      INSERT INTO propiedades (nombre, direccion, estatus)
      VALUES (?, ?, TRUE)
      `,
            [nombre, direccion]
        );

        const idPropiedad = result.insertId;

        // REGISTRO EN AUDITORÍA
        const accion = `${usuario.usuario} creó la propiedad "${nombre}" (ID: ${idPropiedad})`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [usuario.idUsuario, accion]
        );

        await connection.commit();

        notificarCambioPropiedades("propiedad-creada", {
            idPropiedad,
            nombre,
            direccion,
            estatus: 1
        });

        res.status(201).json({
            success: true,
            message: "Propiedad creada correctamente",
            idPropiedad
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al crear la propiedad"
        });
    } finally {
        connection.release();
    }
};

// ?GET: Obtener todas las propiedades activas
export const obtenerPropiedadesActivas = async (req, res) => {
    try {

        let query = `
            SELECT idPropiedad, nombre, direccion, estatus
            FROM propiedades
            WHERE estatus = TRUE
        `;

        let params = [];

        // Si NO es ADMIN, filtrar por su propiedad
        if (req.usuario.rol === "ADMIN_PROPIEDAD" || req.usuario.rol === "LECTURA") {

            query += " AND idPropiedad = ?";
            params.push(req.usuario.idPropiedad);
        }

        query += " ORDER BY idPropiedad ASC";

        const [propiedades] = await db.query(query, params);

        res.status(200).json({
            success: true,
            total: propiedades.length,
            data: propiedades
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al obtener propiedades"
        });
    }
};

// ?GET: Obtener propiedad por ID
export const obtenerPropiedadPorId = async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await db.query(
            `
            SELECT idPropiedad, nombre, direccion, estatus
            FROM propiedades
            WHERE idPropiedad = ?
            `,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Propiedad no encontrada"
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al obtener la propiedad"
        });
    }
};

// ?PUT: Actualizar propiedad (solo ADMIN)
export const actualizarPropiedad = async (req, res) => {
    const { id } = req.params;
    const { nombre, direccion } = req.body;
    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!nombre || !direccion) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Nombre y dirección son obligatorios"
            });
        }

        await connection.beginTransaction();

        // Verificar que exista
        const [existe] = await connection.query(
            `SELECT * FROM propiedades WHERE idPropiedad = ?`,
            [id]
        );

        if (existe.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: "Propiedad no encontrada"
            });
        }

        // Actualizar
        await connection.query(
            `
            UPDATE propiedades
            SET nombre = ?, direccion = ?
            WHERE idPropiedad = ?
            `,
            [nombre, direccion, id]
        );

        // AUDITORÍA
        const accion = `${usuario.usuario} actualizó la propiedad "${nombre}" (ID: ${id})`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [usuario.idUsuario, accion]
        );

        await connection.commit();

        // Notificar por SSE
        notificarCambioPropiedades("propiedad-actualizada", {
            idPropiedad: parseInt(id),
            nombre,
            direccion,
            estatus: 1
        });

        res.status(200).json({
            success: true,
            message: "Propiedad actualizada correctamente"
        });

    } catch (error) {
        await connection.rollback();
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al actualizar la propiedad"
        });
    } finally {
        connection.release();
    }
};

// ?DELETE: Eliminar propiedad (solo ADMIN) - Elimnacion logica (estatus = false)
export const eliminarPropiedadCompleta = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Verificar existencia y obtener nombre
        const [propiedadRows] = await connection.query(
            "SELECT nombre FROM propiedades WHERE idPropiedad = ?",
            [id]
        );

        if (propiedadRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Propiedad no encontrada" });
        }

        const nombrePropiedad = propiedadRows[0].nombre;

        // Desactivar propiedad
        await connection.query(
            "UPDATE propiedades SET estatus = FALSE WHERE idPropiedad = ?",
            [id]
        );

        // Obtener relaciones
        const [propiedadAreas] = await connection.query(
            "SELECT idPropiedadArea FROM propiedad_area WHERE idPropiedad = ?",
            [id]
        );

        for (let pa of propiedadAreas) {

            await connection.query(
                "UPDATE empleados SET estatus = FALSE WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(`
                UPDATE usuarios 
                SET estatus = FALSE 
                WHERE idEmpleado IN (
                    SELECT idEmpleado FROM empleados WHERE idPropiedadArea = ?
                )
            `, [pa.idPropiedadArea]);

            await connection.query(
                "UPDATE propiedad_area_horario SET estatus = FALSE WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(
                "UPDATE propiedad_area SET estatus = FALSE WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(`
                UPDATE horarios 
                SET estatus = FALSE
                WHERE idHorario IN (
                    SELECT idHorario
                    FROM propiedad_area_horario
                    WHERE idPropiedadArea = ?
                )
            `, [pa.idPropiedadArea]);

            await connection.query(`
                UPDATE horario_dias
                SET estatus = FALSE
                WHERE idHorario IN (
                    SELECT idHorario
                    FROM propiedad_area_horario
                    WHERE idPropiedadArea = ?
                )
            `, [pa.idPropiedadArea]);

        }

        // Auditoría corregida
        await connection.query(
            "INSERT INTO auditoria (idUsuario, accion, fecha, hora) VALUES (?, ?, CURDATE(), CURTIME())",
            [
                req.usuario.idUsuario,
                `Eliminación COMPLETA de la propiedad "${nombrePropiedad}" (ID: ${id})`
            ]
        );

        await connection.commit();

        // Notificar por SSE
        notificarCambioPropiedades("propiedad-eliminada-completa", {
            idPropiedad: parseInt(id),
            estatus: 0
        });


        res.status(200).json({ success: true });

    } catch (error) {
        console.error("ERROR eliminarPropiedadCompleta:", error);
        await connection.rollback();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};



export const eliminarSoloPropiedad = async (req, res) => {
    const { id } = req.params;
    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        // Verificar existencia y obtener nombre
        const [propiedadRows] = await connection.query(
            "SELECT nombre FROM propiedades WHERE idPropiedad = ?",
            [id]
        );

        if (propiedadRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Propiedad no encontrada" });
        }

        const nombrePropiedad = propiedadRows[0].nombre;

        // Desactivar propiedad
        await connection.query(
            "UPDATE propiedades SET estatus = FALSE WHERE idPropiedad = ?",
            [id]
        );

        const [propiedadAreas] = await connection.query(
            "SELECT idPropiedadArea FROM propiedad_area WHERE idPropiedad = ?",
            [id]
        );

        for (let pa of propiedadAreas) {

            // REQUIERE idPropiedadArea NULL permitido
            await connection.query(
                "UPDATE empleados SET idPropiedadArea = NULL WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(
                "UPDATE propiedad_area_horario SET estatus = FALSE WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(
                "UPDATE propiedad_area SET estatus = FALSE WHERE idPropiedadArea = ?",
                [pa.idPropiedadArea]
            );

            await connection.query(`
                UPDATE horarios 
                SET estatus = FALSE
                WHERE idHorario IN (
                    SELECT idHorario
                    FROM propiedad_area_horario
                    WHERE idPropiedadArea = ?
                )
            `, [pa.idPropiedadArea]);

            await connection.query(`
                UPDATE horario_dias
                SET estatus = FALSE
                WHERE idHorario IN (
                    SELECT idHorario
                    FROM propiedad_area_horario
                    WHERE idPropiedadArea = ?
                )
            `, [pa.idPropiedadArea]);

        }

        // Auditoría corregida
        await connection.query(
            "INSERT INTO auditoria (idUsuario, accion, fecha, hora) VALUES (?, ?, CURDATE(), CURTIME())",
            [
                req.usuario.idUsuario,
                `Eliminación SOLO de la propiedad "${nombrePropiedad}" (ID: ${id}). Empleados conservados.`
            ]
        );

        await connection.commit();

        notificarCambioPropiedades("propiedad-eliminada-solo", {
            idPropiedad: parseInt(id),
            estatus: 0
        });

        res.status(200).json({ success: true });

    } catch (error) {
        console.error("ERROR eliminarSoloPropiedad:", error);
        await connection.rollback();
        res.status(500).json({ success: false, message: error.message });
    } finally {
        connection.release();
    }
};

