import { db } from "../config/database.js";
import { notificarCambioEmpleados } from "../sse/empleados.sse.js";

// Generar PIN único
const generarPinUnico = async (connection, idPropiedad) => {

    let pin;
    let existe = true;

    while (existe) {

        const random = Math.floor(1000 + Math.random() * 9000); // 4 dígitos
        pin = parseInt(`${idPropiedad}${random}`);

        const [rows] = await connection.query(
            "SELECT idEmpleado FROM empleados WHERE pin = ?",
            [pin]
        );

        existe = rows.length > 0;
    }

    return pin;
};


// CREAR EMPLEADO
export const crearEmpleado = async (req, res) => {

    const {
        nombre,
        apellidos,
        numeroEmpleado,
        puesto,
        idPropiedadArea
    } = req.body;

    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!nombre || !apellidos || !idPropiedadArea || !puesto) {
            return res.status(400).json({
                success: false,
                message: "Datos obligatorios incompletos"
            });
        }

        await connection.beginTransaction();

        // 1Obtener idPropiedad desde propiedad_area
        const [propiedadArea] = await connection.query(
            `
            SELECT pa.idPropiedad, p.nombre AS nombrePropiedad, a.nombreArea
            FROM propiedad_area pa
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            INNER JOIN areas a ON a.idArea = pa.idArea
            WHERE pa.idPropiedadArea = ?
              AND pa.estatus = TRUE
              AND p.estatus = TRUE
              AND a.estatus = TRUE
            `,
            [idPropiedadArea]
        );

        if (propiedadArea.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Área-Propiedad inválida"
            });
        }

        const { idPropiedad, nombrePropiedad, nombreArea } = propiedadArea[0];

        // Generar PIN único
        const pin = await generarPinUnico(connection, idPropiedad);

        // Insertar empleado
        const [result] = await connection.query(
            `
            INSERT INTO empleados
            (nombre, apellidos, numeroEmpleado, puesto, pin, idPropiedadArea, estatus, fechaRegistro)
            VALUES (?, ?, ?, ?, ?, ?, TRUE, CURDATE())
            `,
            [
                nombre,
                apellidos,
                numeroEmpleado || null,
                puesto || null,
                pin,
                idPropiedadArea
            ]
        );

        const idEmpleado = result.insertId;

        // Auditoría
        const accion = `${usuario.usuario} creó el empleado ${nombre} ${apellidos}`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [usuario.idUsuario, accion]
        );

        await connection.commit();

        // Notificar SSE
        const [empleadoCompleto] = await db.query(
            `
            SELECT 
                e.idEmpleado,
                e.nombre,
                e.apellidos,
                e.numeroEmpleado,
                e.puesto,
                e.pin,
                e.estatus,
                pa.idPropiedadArea,
                p.nombre AS nombrePropiedad,
                a.nombreArea,
                h.horaEntrada,
                h.horaSalida
            FROM empleados e
            LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
            LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            LEFT JOIN areas a ON a.idArea = pa.idArea
            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = TRUE
            LEFT JOIN horarios h
                ON h.idHorario = pah.idHorario
                AND h.estatus = TRUE
            WHERE e.idEmpleado = ?
            LIMIT 1
            `,
            [idEmpleado]
        );

        notificarCambioEmpleados("empleado-creado", empleadoCompleto[0]);

        res.status(201).json({
            success: true,
            idEmpleado,
            pin
        });

    } catch (error) {

        await connection.rollback();

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Número de empleado ya en uso"
            });
        }

        console.error(error);
        res.status(500).json({ success: false });

    } finally {
        connection.release();
    }
};

// OBTENER EMPLEADOS ACTIVOS
export const obtenerEmpleadosActivos = async (req, res) => {

    try {

        const [empleados] = await db.query(
            `
            SELECT 
                e.idEmpleado,
                e.nombre,
                e.apellidos,
                e.numeroEmpleado,
                e.puesto,
                e.pin,
                e.estatus,
                e.fechaRegistro,

                pa.idPropiedadArea,

                p.idPropiedad,
                p.nombre AS nombrePropiedad,

                a.idArea,
                a.nombreArea,

                h.horaEntrada,
                h.horaSalida

            FROM empleados e

            LEFT JOIN propiedad_area pa 
                ON pa.idPropiedadArea = e.idPropiedadArea

            LEFT JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad

            LEFT JOIN areas a 
                ON a.idArea = pa.idArea

            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = TRUE

            LEFT JOIN horarios h
                ON h.idHorario = pah.idHorario
                AND h.estatus = TRUE

            WHERE e.estatus = TRUE
            ORDER BY e.nombre ASC
            `
        );

        res.status(200).json({
            success: true,
            total: empleados.length,
            data: empleados
        });

    } catch (error) {

        console.error(error);
        res.status(500).json({ success: false });

    }
};


// OBTENER ÁREAS-PROPIEDADES PARA EMPLEADO
export const obtenerAreasPropiedadParaEmpleado = async (req, res) => {

    try {

        const [rows] = await db.query(
            `
            SELECT 
                pa.idPropiedadArea,
                a.nombreArea,
                p.nombre AS nombrePropiedad
            FROM propiedad_area pa
            INNER JOIN areas a ON a.idArea = pa.idArea
            INNER JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE pa.estatus = TRUE
              AND a.estatus = TRUE
              AND p.estatus = TRUE
            ORDER BY p.nombre ASC, a.nombreArea ASC
            `
        );

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


// OBTENER EMPLEADO POR ID
export const obtenerEmpleadoPorId = async (req, res) => {

    const { id } = req.params;

    try {

        const [rows] = await db.query(
            `
            SELECT 
                e.idEmpleado,
                e.nombre,
                e.apellidos,
                e.numeroEmpleado,
                e.puesto,
                e.pin,
                e.estatus,
                e.idPropiedadArea,

                p.idPropiedad,
                p.nombre AS nombrePropiedad,

                a.idArea,
                a.nombreArea

            FROM empleados e

            LEFT JOIN propiedad_area pa 
                ON pa.idPropiedadArea = e.idPropiedadArea

            LEFT JOIN propiedades p 
                ON p.idPropiedad = pa.idPropiedad

            LEFT JOIN areas a 
                ON a.idArea = pa.idArea

            WHERE e.idEmpleado = ?
            LIMIT 1
            `,
            [id]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Empleado no encontrado"
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


// ACTUALIZAR EMPLEADO
export const actualizarEmpleado = async (req, res) => {

    const { id } = req.params;
    const {
        nombre,
        apellidos,
        numeroEmpleado,
        puesto,
        idPropiedadArea
    } = req.body;

    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        if (!nombre || !apellidos || !idPropiedadArea) {
            return res.status(400).json({
                success: false,
                message: "Datos obligatorios incompletos"
            });
        }

        await connection.beginTransaction();

        const [existe] = await connection.query(
            "SELECT * FROM empleados WHERE idEmpleado = ?",
            [id]
        );

        if (existe.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Empleado no encontrado"
            });
        }

        await connection.query(
            `
            UPDATE empleados
            SET nombre = ?,
                apellidos = ?,
                numeroEmpleado = ?,
                puesto = ?,
                idPropiedadArea = ?
            WHERE idEmpleado = ?
            `,
            [
                nombre,
                apellidos,
                numeroEmpleado || null,
                puesto || null,
                idPropiedadArea,
                id
            ]
        );

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                `${usuario.usuario} actualizó el empleado ${nombre} ${apellidos}`
            ]
        );

        await connection.commit();

        const [empleadoCompleto] = await db.query(
            `
            SELECT 
                e.idEmpleado,
                e.nombre,
                e.apellidos,
                e.numeroEmpleado,
                e.puesto,
                e.pin,
                e.estatus,
                pa.idPropiedadArea,
                p.nombre AS nombrePropiedad,
                a.nombreArea,
                h.horaEntrada,
                h.horaSalida
            FROM empleados e
            LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
            LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            LEFT JOIN areas a ON a.idArea = pa.idArea
            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = TRUE
            LEFT JOIN horarios h
                ON h.idHorario = pah.idHorario
                AND h.estatus = TRUE
            WHERE e.idEmpleado = ?
            LIMIT 1
            `,
            [id]
        );

        notificarCambioEmpleados("empleado-actualizado", empleadoCompleto[0]);

        res.status(200).json({ success: true });

    } catch (error) {
        await connection.rollback();

        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                success: false,
                message: "Número de empleado ya en uso"
            });
        }

        console.error(error);
        res.status(500).json({ success: false });
    } finally {
        connection.release();
    }
};

// ELIMINACIÓN LÓGICA EMPLEADO
export const eliminarEmpleado = async (req, res) => {

    const { id } = req.params;
    const usuario = req.usuario;
    const connection = await db.getConnection();

    try {

        await connection.beginTransaction();

        // Verificar que exista
        const [empleado] = await connection.query(
            "SELECT * FROM empleados WHERE idEmpleado = ?",
            [id]
        );

        if (empleado.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Empleado no encontrado"
            });
        }

        const empleadoData = empleado[0];
        const nombreCompleto = `${empleadoData.nombre} ${empleadoData.apellidos}`;


        // Desactivar empleado
        await connection.query(
            "UPDATE empleados SET estatus = FALSE WHERE idEmpleado = ?",
            [id]
        );

        // Desactivar usuario si existe
        await connection.query(
            `
            UPDATE usuarios 
            SET estatus = FALSE 
            WHERE idEmpleado = ?
            `,
            [id]
        );

        // Auditoría
        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [
                usuario.idUsuario,
                `${usuario.usuario} desactivó el empleado: ${nombreCompleto} (ID: ${id})`
            ]
        );


        await connection.commit();

        // Notificar SSE
        notificarCambioEmpleados("empleado-eliminado", {
            idEmpleado: parseInt(id),
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

