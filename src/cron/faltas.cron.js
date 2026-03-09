import cron from 'node-cron';
import { db } from '../config/database.js';

cron.schedule('* * * * *', async () => {

    try {

        await db.query(`
            INSERT INTO incidencias (idEmpleado, tipoIncidencia, fecha, justificada)
            SELECT 
                e.idEmpleado,
                'FALTA',
                CURDATE(),
                0
            FROM empleados e
            JOIN propiedad_area pa 
                ON e.idPropiedadArea = pa.idPropiedadArea
            JOIN propiedad_area_horario pah 
                ON pa.idPropiedadArea = pah.idPropiedadArea
            JOIN horarios h 
                ON pah.idHorario = h.idHorario
            JOIN horario_dias hd
                ON h.idHorario = hd.idHorario
            WHERE e.estatus = 1
            AND pah.estatus = 1
            AND h.estatus = 1
            AND hd.estatus = 1
            AND hd.diaSemana = UPPER(DAYNAME(CURDATE()))
            AND TIME(NOW()) > h.horaSalida
            AND NOT EXISTS (
                SELECT 1
                FROM asistencias a
                WHERE a.idEmpleado = e.idEmpleado
                AND a.fecha = CURDATE()
                AND a.tipoRegistro = 'ENTRADA'
            )
            AND NOT EXISTS (
                SELECT 1
                FROM incidencias i
                WHERE i.idEmpleado = e.idEmpleado
                AND i.fecha = CURDATE()
                AND i.tipoIncidencia = 'FALTA'
            );
        `);

    } catch (error) {
        console.error("Error en cron faltas:", error);
    }

});