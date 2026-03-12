import fs from "fs";
import path from "path";
import { db } from "../config/database.js";

export const obtenerReportesAsistencia = async (req, res) => {

    try {

        const { idPropiedad, idEmpleado, fechaInicio, fechaFin } = req.query;
        if (!fechaInicio || !fechaFin) {

            return res.status(400).json({
                success: false,
                message: "Debe enviar fechaInicio y fechaFin"
            });

        }

        if (!idPropiedad) {

            return res.status(400).json({
                success: false,
                message: "Debe enviar idPropiedad"
            });

        }

        const usuario = req.usuario;

        let filtros = "";
        let paramsAsistencia = [];
        let paramsFaltas = [];

        // FILTRO POR ROL
        if (usuario.rol === "ADMIN_PROPIEDAD" || usuario.rol === "LECTURA") {

            filtros += ` AND p.idPropiedad = ? `;

            paramsAsistencia.push(usuario.idPropiedad);
            paramsFaltas.push(usuario.idPropiedad);

        }

        if (usuario.rol === "ADMIN" && idPropiedad) {

            filtros += ` AND p.idPropiedad = ? `;

            paramsAsistencia.push(idPropiedad);
            paramsFaltas.push(idPropiedad);

        }

        // FILTRO EMPLEADO
        if (idEmpleado && idEmpleado !== "0") {

            filtros += ` AND e.idEmpleado = ? `;

            paramsAsistencia.push(idEmpleado);
            paramsFaltas.push(idEmpleado);

        }

        // FILTRO FECHA
        let filtroFechaAsistencia = "";
        let filtroFechaIncidencia = "";

        if (fechaInicio && fechaFin) {

            filtroFechaAsistencia = ` AND ah.fecha BETWEEN ? AND ? `;
            filtroFechaIncidencia = ` AND i.fecha BETWEEN ? AND ? `;

            paramsAsistencia.push(fechaInicio, fechaFin);
            paramsFaltas.push(fechaInicio, fechaFin);

        }

        const query = `

        SELECT * FROM (

            /* =========================
               REGISTROS CON ASISTENCIA
            ========================== */

            SELECT

                ah.fecha,
                ah.numeroEmpleado,
                ah.nombreEmpleado,
                e.puesto,
                ah.area,

                CASE 
                    WHEN i.tipoIncidencia = 'RETARDO' THEN 'SI'
                    ELSE 'NO'
                END AS retardo,

                CASE 
                    WHEN i.tipoIncidencia = 'RETARDO'
                    THEN TIMEDIFF(a.hora, h.horaEntrada)
                    ELSE 'N/A'
                END AS tiempoRetardo,

                'NO' AS falta,

                CASE
                    WHEN i.tipoIncidencia = 'EXTEMPORANEO' THEN 'SI'
                    ELSE 'NO'
                END AS extemporaneo,

                a.hora AS horaLlegada,

                CASE
                    WHEN a_salida.hora IS NULL THEN 'Sin registro de salida'
                    ELSE a_salida.hora
                END AS horaSalida,

                a.idAsistencia,
                ah.fotografia

            FROM asistencias_historial ah

            LEFT JOIN empleados e
                ON e.idEmpleado = ah.idEmpleado

            LEFT JOIN asistencias a
                ON a.idEmpleado = ah.idEmpleado
                AND a.fecha = ah.fecha
                AND a.tipoRegistro = 'ENTRADA'

            LEFT JOIN asistencias a_salida
                ON a_salida.idEmpleado = ah.idEmpleado
                AND a_salida.fecha = ah.fecha
                AND a_salida.tipoRegistro = 'SALIDA'

            LEFT JOIN incidencias i
                ON i.idEmpleado = ah.idEmpleado
                AND i.fecha = ah.fecha

            LEFT JOIN propiedad_area pa
                ON pa.idPropiedadArea = e.idPropiedadArea

            LEFT JOIN propiedades p
                ON p.idPropiedad = pa.idPropiedad

            LEFT JOIN propiedad_area_horario pah
                ON pah.idPropiedadArea = pa.idPropiedadArea
                AND pah.estatus = 1

            LEFT JOIN horarios h
                ON h.idHorario = pah.idHorario
                AND h.estatus = 1

            WHERE 1=1
            AND ah.tipoRegistro = 'ENTRADA'
            ${filtros}
            ${filtroFechaAsistencia}

            UNION ALL

            /* =========================
               REGISTROS DE FALTAS
            ========================== */

            SELECT

                i.fecha,
                e.numeroEmpleado,
                CONCAT(e.nombre,' ',e.apellidos) AS nombreEmpleado,
                e.puesto,
                ar.nombreArea AS area,

                'NO' AS retardo,
                'N/A' AS tiempoRetardo,
                'SI' AS falta,
                'NO' AS extemporaneo,
                'N/A' AS horaLlegada,
                'N/A' AS horaSalida,

                NULL AS idAsistencia,
                NULL AS fotografia

            FROM incidencias i

            INNER JOIN empleados e
                ON e.idEmpleado = i.idEmpleado

            LEFT JOIN propiedad_area pa
                ON pa.idPropiedadArea = e.idPropiedadArea

            LEFT JOIN areas ar
                ON ar.idArea = pa.idArea

            LEFT JOIN propiedades p
                ON p.idPropiedad = pa.idPropiedad

            WHERE i.tipoIncidencia = 'FALTA'
            ${filtros}
            ${filtroFechaIncidencia}

        ) reporte

        ORDER BY fecha DESC, nombreEmpleado ASC

        `;

        const params = [...paramsAsistencia, ...paramsFaltas];

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

export const obtenerFotoAsistencia = async (req, res) => {

    const { idAsistencia  } = req.params;

    try {

        const [rows] = await db.query(`
            SELECT fotografia
            FROM asistencias
            WHERE idAsistencia = ?
            LIMIT 1
        `, [idAsistencia ]);

        if(rows.length === 0 || !rows[0].fotografia){

            return res.status(404).json({
                success:false,
                message:"Foto no encontrada"
            });

        }

        const ruta = rows[0].fotografia;

        if(!fs.existsSync(ruta)){

            return res.status(404).json({
                success:false,
                message:"Archivo no existe en servidor"
            });

        }

        return res.sendFile(path.resolve(ruta));

    } catch(error){

        console.error(error);

        res.status(500).json({
            success:false
        });

    }

};