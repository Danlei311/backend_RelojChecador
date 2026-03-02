import { db } from '../config/database.js';
import fs from "fs";
import path from "path";

// ==================================================
// Metodos del reloj checador

// Validar PIN de empleado
async function obtenerEmpleadoPorPin(pin) {
    const [empleados] = await db.query(`
        SELECT 
            e.idEmpleado,
            e.numeroEmpleado,
            e.idPropiedadArea,
            CONCAT(e.nombre, ' ', e.apellidos) AS nombreEmpleado,
            h.idHorario,
            h.horaEntrada,
            h.horaSalida,
            h.toleranciaMinutos,
            p.nombre AS propiedad,
            a.nombreArea AS area
        FROM empleados e
        JOIN propiedad_area pa ON e.idPropiedadArea = pa.idPropiedadArea
        JOIN propiedades p ON pa.idPropiedad = p.idPropiedad
        JOIN areas a ON pa.idArea = a.idArea
        JOIN propiedad_area_horario pah ON pa.idPropiedadArea = pah.idPropiedadArea
        JOIN horarios h ON pah.idHorario = h.idHorario
        WHERE e.pin = ? 
        AND e.estatus = 1
        AND h.estatus = 1
        AND pah.estatus = 1
        LIMIT 1
    `, [pin]);

    return empleados.length ? empleados[0] : null;
}

async function esDiaLaboral(idHorario, now) {

    const diasSemana = [
        'DOMINGO',
        'LUNES',
        'MARTES',
        'MIERCOLES',
        'JUEVES',
        'VIERNES',
        'SABADO'
    ];

    const diaActual = diasSemana[now.getDay()];

    const [dias] = await db.query(`
        SELECT 1
        FROM horario_dias
        WHERE idHorario = ?
        AND diaSemana = ?
        AND estatus = 1
    `, [idHorario, diaActual]);

    return dias.length > 0;
}

// Validar tipo de resgistro Entrada/Salida
async function verificarTipoRegistro(idEmpleado, fechaHoy) {
    const [registros] = await db.query(`
        SELECT tipoRegistro 
        FROM asistencias 
        WHERE idEmpleado = ? AND fecha = ?
        ORDER BY hora ASC
    `, [idEmpleado, fechaHoy]);

    if (registros.length === 0) return "ENTRADA";
    if (registros.length === 1 && registros[0].tipoRegistro === "ENTRADA") return "SALIDA";
    if (registros.length === 1 && registros[0].tipoRegistro === "SALIDA")
        return "ERROR_YA_SALIDA";
    if (registros.length >= 2)
        return "ERROR_COMPLETO";

    return "ERROR";
}

// Verificar puntualidad en el registro de entrada
function evaluarPuntualidad(horaEntrada, toleranciaMinutos, now) {
    const [h, m, s] = horaEntrada.split(':');
    const horaEsperada = new Date(now);
    horaEsperada.setHours(h, m, s, 0);

    const limite = new Date(horaEsperada);
    limite.setMinutes(limite.getMinutes() + toleranciaMinutos);

    return now <= limite ? "A_TIEMPO" : "RETARDO";
}

// Registro de asistencia
async function registrarAsistencia(empleado, tipoRegistro, now) {
    const fechaHoy = obtenerFechaLocal(now);
    const horaActual = obtenerHoraLocal(now);

    // Insert en asistencias
    const [result] = await db.query(`
        INSERT INTO asistencias 
        (idEmpleado, tipoRegistro, fecha, hora)
        VALUES (?, ?, ?, ?)
    `, [empleado.idEmpleado, tipoRegistro, fechaHoy, horaActual]);

    // Insert en historial
    await db.query(`
        INSERT INTO asistencias_historial 
        (idEmpleado, nombreEmpleado, numeroEmpleado, propiedad, area, 
         tipoRegistro, fecha, hora)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        empleado.idEmpleado,
        empleado.nombreEmpleado,
        empleado.numeroEmpleado || null,
        empleado.propiedad,
        empleado.area,
        tipoRegistro,
        fechaHoy,
        horaActual
    ]);

    return result.insertId;
}

// ==================================================

export const validarPin = async (req, res) => {
    const { pin } = req.body;
    const now = new Date();
    const fechaHoy = obtenerFechaLocal(now);

    try {

        const empleado = await obtenerEmpleadoPorPin(pin);

        if (!empleado) {
            return res.status(404).json({
                success: false,
                message: "PIN no encontrado"
            });
        }

        const esLaboral = await esDiaLaboral(empleado.idHorario, now);

        const tipoRegistro = await verificarTipoRegistro(
            empleado.idEmpleado,
            fechaHoy
        );

        if (tipoRegistro === "ERROR_YA_SALIDA") {
            return res.status(400).json({
                success: false,
                message: "Ya registraste tu salida hoy"
            });
        }

        if (tipoRegistro === "ERROR_COMPLETO") {
            return res.status(400).json({
                success: false,
                message: "Registro completo del día"
            });
        }

        let estadoEntrada = null;

        // =========================
        // SI ES ENTRADA
        // =========================
        if (tipoRegistro === "ENTRADA") {

            if (!esLaboral) {

                // Día NO laboral → EXTEMPORANEO
                await db.query(`
                    DELETE FROM incidencias
                    WHERE idEmpleado = ?
                    AND fecha = CURDATE()
                    AND tipoIncidencia = 'FALTA'
                `, [empleado.idEmpleado]);

                await db.query(`
                    INSERT INTO incidencias
                    (idEmpleado, tipoIncidencia, fecha, justificada)
                    VALUES (?, 'EXTEMPORANEO', CURDATE(), 0)
                `, [empleado.idEmpleado]);

                estadoEntrada = "EXTEMPORANEO";

            } else {

                // Día laboral
                const puntualidad = evaluarPuntualidad(
                    empleado.horaEntrada,
                    empleado.toleranciaMinutos,
                    now
                );

                const [h, m, s] = empleado.horaSalida.split(':');
                const horaSalida = new Date(now);
                horaSalida.setHours(h, m, s, 0);

                if (now > horaSalida) {

                    // Llegó después de salida → EXTEMPORANEO
                    await db.query(`
                        DELETE FROM incidencias
                        WHERE idEmpleado = ?
                        AND fecha = CURDATE()
                        AND tipoIncidencia = 'FALTA'
                    `, [empleado.idEmpleado]);

                    await db.query(`
                        INSERT INTO incidencias
                        (idEmpleado, tipoIncidencia, fecha, justificada)
                        VALUES (?, 'EXTEMPORANEO', CURDATE(), 0)
                    `, [empleado.idEmpleado]);

                    estadoEntrada = "EXTEMPORANEO";

                } else if (puntualidad === "RETARDO") {

                    await db.query(`
                        INSERT INTO incidencias
                        (idEmpleado, tipoIncidencia, fecha, justificada)
                        VALUES (?, 'RETARDO', CURDATE(), 0)
                    `, [empleado.idEmpleado]);

                    estadoEntrada = "RETARDO";

                } else {
                    estadoEntrada = "A_TIEMPO";
                }
            }
        }

        const idAsistencia = await registrarAsistencia(
            empleado,
            tipoRegistro,
            now
        );

        return res.json({
            success: true,
            data: {
                idAsistencia,
                nombre: empleado.nombreEmpleado,
                tipoRegistro,
                estadoEntrada
            }
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error procesando asistencia"
        });
    }
};

export const subirFoto = async (req, res) => {
    const { idAsistencia, rutaFoto, imagenBase64 } = req.body;

    try {
        if (!idAsistencia || !imagenBase64) {
            return res.status(400).json({
                success: false,
                message: "Faltan datos para guardar la foto"
            });
        }

        // Carpeta donde se guardarán en el servidor
        const carpeta = "C:/servidor_fotos";

        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }

        // Nombre del archivo
        const nombreArchivo = path.basename(rutaFoto);
        const rutaServidor = path.join(carpeta, nombreArchivo);

        // Convertir Base64 a archivo físico
        const buffer = Buffer.from(imagenBase64, "base64");
        fs.writeFileSync(rutaServidor, buffer);

        // UPDATE en tabla asistencias
        await db.query(`
            UPDATE asistencias
            SET fotografia = ?
            WHERE idAsistencia = ?
        `, [rutaServidor, idAsistencia]);

        // UPDATE en historial también
        await db.query(`
            UPDATE asistencias_historial
            SET fotografia = ?
            WHERE idEmpleado = (
                SELECT idEmpleado FROM asistencias WHERE idAsistencia = ?
            )
            AND fecha = CURDATE()
        `, [rutaServidor, idAsistencia]);

        res.json({
            success: true,
            message: "Foto guardada correctamente",
            ruta: rutaServidor
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            success: false,
            message: "Error al guardar la foto"
        });
    }
};

function obtenerFechaLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function obtenerHoraLocal(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}