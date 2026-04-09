import { db } from '../config/database.js';
import fs from 'fs';
import path from 'path';

// Endpoint para registrar asistencia offline
export const registrarAsistenciaOffline = async (req, res) => {
    const { pin, horaLocal, fechaLocal, tipoRegistro, fotoBase64 } = req.body;
    
    const connection = await db.getConnection();
    
    try {
        await connection.beginTransaction();
        
        // 1. Obtener empleado por PIN
        const [empleados] = await connection.query(`
            SELECT e.idEmpleado, e.numeroEmpleado, e.idPropiedadArea,
                   CONCAT(e.nombre, ' ', e.apellidos) AS nombreEmpleado,
                   h.idHorario, h.horaEntrada, h.horaSalida, h.toleranciaMinutos,
                   p.nombre AS propiedad, a.nombreArea AS area
            FROM empleados e
            JOIN propiedad_area pa ON e.idPropiedadArea = pa.idPropiedadArea
            JOIN propiedades p ON pa.idPropiedad = p.idPropiedad
            JOIN areas a ON pa.idArea = a.idArea
            JOIN propiedad_area_horario pah ON pa.idPropiedadArea = pah.idPropiedadArea
            JOIN horarios h ON pah.idHorario = h.idHorario
            WHERE e.pin = ? AND e.estatus = 1 AND h.estatus = 1 AND pah.estatus = 1
            LIMIT 1
        `, [pin]);
        
        if (empleados.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "PIN no encontrado" });
        }
        
        const empleado = empleados[0];
        const now = new Date(fechaLocal + "T" + horaLocal);
        const fechaHoy = fechaLocal;
        const horaActual = horaLocal;
        
        // 2. Verificar si ya existe registro para hoy
        const [existeAsistencia] = await connection.query(`
            SELECT tipoRegistro FROM asistencias 
            WHERE idEmpleado = ? AND fecha = ? 
            ORDER BY hora ASC
        `, [empleado.idEmpleado, fechaHoy]);
        
        let tipoRegistroFinal = tipoRegistro || "ENTRADA";
        
        if (existeAsistencia.length === 1 && existeAsistencia[0].tipoRegistro === "ENTRADA") {
            tipoRegistroFinal = "SALIDA";
        } else if (existeAsistencia.length >= 2) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: "Registro completo del día" });
        }
        
        // 3. Registrar asistencia
        const [result] = await connection.query(`
            INSERT INTO asistencias (idEmpleado, tipoRegistro, fecha, hora)
            VALUES (?, ?, ?, ?)
        `, [empleado.idEmpleado, tipoRegistroFinal, fechaHoy, horaActual]);
        
        // 4. Guardar en historial
        await connection.query(`
            INSERT INTO asistencias_historial 
            (idEmpleado, nombreEmpleado, numeroEmpleado, propiedad, area, tipoRegistro, fecha, hora)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [empleado.idEmpleado, empleado.nombreEmpleado, empleado.numeroEmpleado || null,
            empleado.propiedad, empleado.area, tipoRegistroFinal, fechaHoy, horaActual]);
        
        // 5. Gestionar incidencias (eliminar falta si existe, crear retardo/extemporaneo)
        // ELIMINAR FALTA si existe
        await connection.query(`
            DELETE FROM incidencias 
            WHERE idEmpleado = ? AND fecha = ? AND tipoIncidencia = 'FALTA'
        `, [empleado.idEmpleado, fechaHoy]);
        
        // 6. Si es ENTRADA, evaluar puntualidad
        if (tipoRegistroFinal === "ENTRADA") {
            const [esLaboralRows] = await connection.query(`
                SELECT 1 FROM horario_dias 
                WHERE idHorario = ? AND diaSemana = ? AND estatus = 1
            `, [empleado.idHorario, obtenerDiaSemana(now)]);
            
            if (esLaboralRows.length === 0) {
                // Día no laboral → EXTEMPORANEO
                await connection.query(`
                    INSERT INTO incidencias (idEmpleado, tipoIncidencia, fecha, justificada)
                    VALUES (?, 'EXTEMPORANEO', ?, 0)
                `, [empleado.idEmpleado, fechaHoy]);
            } else {
                // Verificar si llegó después de la hora de salida
                const [hSalida, mSalida] = empleado.horaSalida.split(':');
                const horaSalidaDate = new Date(now);
                horaSalidaDate.setHours(hSalida, mSalida, 0);
                
                if (now > horaSalidaDate) {
                    await connection.query(`
                        INSERT INTO incidencias (idEmpleado, tipoIncidencia, fecha, justificada)
                        VALUES (?, 'EXTEMPORANEO', ?, 0)
                    `, [empleado.idEmpleado, fechaHoy]);
                } else {
                    // Verificar retardo
                    const [hEntrada, mEntrada] = empleado.horaEntrada.split(':');
                    const horaEsperada = new Date(now);
                    horaEsperada.setHours(hEntrada, mEntrada, 0);
                    
                    const limite = new Date(horaEsperada);
                    limite.setMinutes(limite.getMinutes() + empleado.toleranciaMinutos);
                    
                    if (now > limite) {
                        await connection.query(`
                            INSERT INTO incidencias (idEmpleado, tipoIncidencia, fecha, justificada)
                            VALUES (?, 'RETARDO', ?, 0)
                        `, [empleado.idEmpleado, fechaHoy]);
                    }
                }
            }
        }
        
        await connection.commit();
        
        res.json({
            success: true,
            data: {
                idAsistencia: result.insertId,
                nombre: empleado.nombreEmpleado,
                tipoRegistro: tipoRegistroFinal
            }
        });
        
    } catch (error) {
        await connection.rollback();
        console.error("Error en registro offline:", error);
        res.status(500).json({ success: false, message: "Error procesando asistencia offline" });
    } finally {
        connection.release();
    }
};

function obtenerDiaSemana(date) {
    const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'];
    return dias[date.getDay()];
}

// Endpoint para subir foto offline
export const subirFotoOffline = async (req, res) => {
    const { idAsistencia, imagenBase64, rutaFoto } = req.body;
    
    try {
        const carpeta = "C:/servidor_fotos";
        if (!fs.existsSync(carpeta)) {
            fs.mkdirSync(carpeta, { recursive: true });
        }
        
        const nombreArchivo = path.basename(rutaFoto);
        const rutaServidor = path.join(carpeta, nombreArchivo);
        
        const buffer = Buffer.from(imagenBase64, "base64");
        fs.writeFileSync(rutaServidor, buffer);
        
        await db.query(`
            UPDATE asistencias SET fotografia = ? WHERE idAsistencia = ?
        `, [rutaServidor, idAsistencia]);
        
        res.json({ success: true, message: "Foto guardada" });
    } catch (error) {
        console.error("Error en subirFotoOffline:", error);
        res.status(500).json({ success: false, message: error.message });
    }
};

// Endpoint para buscar idAsistencia por PIN y fecha
export const buscarAsistenciaPorPin = async (req, res) => {
    const { pin, fecha } = req.query;
    
    try {
        const [rows] = await db.query(`
            SELECT a.idAsistencia 
            FROM asistencias a
            JOIN empleados e ON a.idEmpleado = e.idEmpleado
            WHERE e.pin = ? AND a.fecha = ?
            ORDER BY a.idAsistencia DESC LIMIT 1
        `, [pin, fecha]);
        
        if (rows.length === 0) {
            return res.status(404).json({ success: false });
        }
        
        res.json(rows[0].idAsistencia);
    } catch (error) {
        res.status(500).json({ success: false });
    }
};