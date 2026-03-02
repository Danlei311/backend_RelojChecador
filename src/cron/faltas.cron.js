import cron from 'node-cron';
import { db } from '../config/database.js';

function obtenerFechaLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

cron.schedule('* * * * *', async () => {

    try {

        const now = new Date();
        const fechaHoy = obtenerFechaLocal(now);

        const diasSemana = [
            'DOMINGO','LUNES','MARTES','MIERCOLES',
            'JUEVES','VIERNES','SABADO'
        ];

        const diaActual = diasSemana[now.getDay()];

        const [empleados] = await db.query(`
            SELECT 
                e.idEmpleado,
                h.idHorario,
                h.horaSalida
            FROM empleados e
            JOIN propiedad_area pa ON e.idPropiedadArea = pa.idPropiedadArea
            JOIN propiedad_area_horario pah ON pa.idPropiedadArea = pah.idPropiedadArea
            JOIN horarios h ON pah.idHorario = h.idHorario
            WHERE e.estatus = 1
            AND pah.estatus = 1
            AND h.estatus = 1
        `);

        for (const empleado of empleados) {

            // 🔹 Verificar si hoy es día laboral
            const [diaLaboral] = await db.query(`
                SELECT 1 
                FROM horario_dias
                WHERE idHorario = ?
                AND diaSemana = ?
                AND estatus = 1
            `, [empleado.idHorario, diaActual]);

            if (!diaLaboral.length) continue;

            // 🔹 Construir horaSalida correctamente
            const [h, m, s] = empleado.horaSalida.split(':');
            const horaSalida = new Date(now);
            horaSalida.setHours(h, m, s, 0);

            // 🔹 Si aún no es hora de salida → NO hacer nada
            if (now <= horaSalida) continue;

            // 🔹 Verificar si ya tiene entrada hoy
            const [entrada] = await db.query(`
                SELECT 1 
                FROM asistencias
                WHERE idEmpleado = ?
                AND fecha = ?
                AND tipoRegistro = 'ENTRADA'
            `, [empleado.idEmpleado, fechaHoy]);

            if (entrada.length) continue;

            // 🔹 Insertar FALTA solo si no existe
            await db.query(`
                INSERT INTO incidencias (idEmpleado, tipoIncidencia, fecha, justificada)
                SELECT ?, 'FALTA', ?, 0
                FROM dual
                WHERE NOT EXISTS (
                    SELECT 1 FROM incidencias
                    WHERE idEmpleado = ?
                    AND fecha = ?
                    AND tipoIncidencia = 'FALTA'
                )
            `, [
                empleado.idEmpleado,
                fechaHoy,
                empleado.idEmpleado,
                fechaHoy
            ]);
        }

    } catch (error) {
        console.error("Error en cron faltas:", error);
    }

});