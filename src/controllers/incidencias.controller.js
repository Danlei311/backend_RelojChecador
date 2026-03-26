import { db } from "../config/database.js";
import { notificarCambioIncidencias } from "../sse/incidencias.sse.js";

export const obtenerIncidencias = async (req, res) => {

    try {

        const { idPropiedad, fecha } = req.query;
        const usuario = req.usuario;

        let query = `
            SELECT DISTINCT
                i.idIncidencia,
                i.tipoIncidencia,
                i.fecha,
                i.justificada,
                i.descripcionJustificacion,

                e.numeroEmpleado,
                e.nombre,
                e.apellidos,
                e.puesto,

                a.nombreArea,

                h.horaEntrada,
                h.horaSalida,

                asi.hora AS horaRegistro,

                p.idPropiedad,
                p.nombre AS nombrePropiedad

            FROM incidencias i

            INNER JOIN empleados e
                ON e.idEmpleado = i.idEmpleado

            LEFT JOIN propiedad_area pa
                ON pa.idPropiedadArea = e.idPropiedadArea

            LEFT JOIN propiedades p
                ON p.idPropiedad = pa.idPropiedad

            LEFT JOIN areas a
                ON a.idArea = pa.idArea

            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = 1

            LEFT JOIN horarios h
                ON h.idHorario = pah.idHorario
                AND h.estatus = 1

            LEFT JOIN asistencias asi
                ON asi.idEmpleado = e.idEmpleado
                AND asi.fecha = i.fecha
                AND asi.tipoRegistro = 'ENTRADA'

            WHERE 1=1
        `;

        let params = [];

        // =========================
        // FILTRO POR ROL
        // =========================

        if (usuario.rol === "ADMIN_PROPIEDAD" || usuario.rol === "LECTURA") {

            query += " AND p.idPropiedad = ?";
            params.push(usuario.idPropiedad);

        }

        // =========================
        // FILTRO ADMIN
        // =========================

        if (usuario.rol === "ADMIN" && idPropiedad && idPropiedad !== "0") {

            query += " AND p.idPropiedad = ?";
            params.push(idPropiedad);

        }

        // =========================
        // FILTRO FECHA
        // =========================

        if (fecha === "HOY") {

            query += " AND i.fecha = CURDATE()";

        }
        else if (fecha === "AYER") {

            query += " AND i.fecha = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";

        }
        else if (fecha === "SEMANA") {

            query += " AND i.fecha >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";

        }
        else if (fecha === "MES") {

            query += " AND i.fecha >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)";

        }
        else if (fecha === "DOS_MESES") {

            query += " AND i.fecha >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)";

        }

        query += " ORDER BY i.fecha DESC";

        const [rows] = await db.query(query, params);

        res.status(200).json({
            success: true,
            total: rows.length,
            data: rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false
        });

    }

};


export const justificarIncidencia = async (req, res) => {

    const { id } = req.params;
    const { descripcion } = req.body;
    const usuario = req.usuario;

    const connection = await db.getConnection();

    try {

        if (!descripcion) {

            return res.status(400).json({
                success: false,
                message: "La descripción es obligatoria"
            });

        }

        await connection.beginTransaction();

        // Verificar existencia
        const [incidencia] = await connection.query(
            `
            SELECT 
                i.idIncidencia,
                i.justificada,
                e.nombre,
                e.apellidos
            FROM incidencias i
            INNER JOIN empleados e
                ON e.idEmpleado = i.idEmpleado
            WHERE i.idIncidencia = ?
            `,
            [id]
        );

        if (incidencia.length === 0) {

            await connection.rollback();

            return res.status(404).json({
                success: false,
                message: "Incidencia no encontrada"
            });

        }

        if (usuario.rol === "LECTURA") {

            await connection.rollback();

            return res.status(403).json({
                success: false,
                message: "No tienes permisos para justificar incidencias"
            });

        }

        if (incidencia[0].justificada === 1) {

            await connection.rollback();

            return res.status(400).json({
                success: false,
                message: "La incidencia ya está justificada"
            });

        }

        // UPDATE
        await connection.query(
            `
            UPDATE incidencias
            SET 
                justificada = TRUE,
                descripcionJustificacion = ?
            WHERE idIncidencia = ?
            `,
            [descripcion, id]
        );

        const nombreEmpleado = `${incidencia[0].nombre} ${incidencia[0].apellidos}`;

        // Auditoría
        const accion = `${usuario.usuario} justificó la incidencia ID ${id} del empleado ${nombreEmpleado}`;

        await connection.query(
            `
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
            `,
            [usuario.idUsuario, accion]
        );

        await connection.commit();

        // SSE
        notificarCambioIncidencias("incidencia-justificada", {
            idIncidencia: parseInt(id),
            justificada: 1,
            descripcion
        });

        res.status(200).json({
            success: true
        });

    } catch (error) {

        await connection.rollback();

        console.error(error);

        res.status(500).json({
            success: false
        });

    } finally {

        connection.release();

    }

};