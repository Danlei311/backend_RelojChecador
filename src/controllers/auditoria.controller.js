import { db } from "../config/database.js";

export const obtenerAuditoria = async (req, res) => {

    try {

        const { idPropiedad, fecha, fechaInicio, fechaFin } = req.query;
        const usuario = req.usuario;

        let query = `
            SELECT 
                a.idAuditoria,
                u.usuario,
                CONCAT(e.nombre, ' ', e.apellidos) AS empleado,
                u.rol,
                a.accion,
                a.fecha,
                a.hora,
                p.idPropiedad,
                p.nombre AS nombrePropiedad
            FROM auditoria a
            INNER JOIN usuarios u ON u.idUsuario = a.idUsuario
            INNER JOIN empleados e ON e.idEmpleado = u.idEmpleado
            LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
            LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE 1=1
        `;

        let params = [];

        // FILTRO POR ROL
        if (usuario.rol === "ADMIN_PROPIEDAD" || usuario.rol === "LECTURA") {
            query += " AND p.idPropiedad = ?";
            params.push(usuario.idPropiedad);
        }

        // FILTRO PARA ADMIN
        if (usuario.rol === "ADMIN" && idPropiedad && idPropiedad !== "0") {
            query += " AND p.idPropiedad = ?";
            params.push(idPropiedad);
        }

        // FILTRO DE FECHA

        if (fechaInicio && fechaFin) {

            query += " AND DATE(a.fecha) BETWEEN ? AND ?";
            params.push(fechaInicio, fechaFin);

        } else {
            if (fecha === "HOY") {
                query += " AND DATE(a.fecha) = CURDATE()";
            }
            else if (fecha === "AYER") {
                query += " AND DATE(a.fecha) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)";
            }
            else if (fecha === "SEMANA") {
                query += " AND DATE(a.fecha) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)";
            }
            else if (fecha === "MES") {
                query += " AND DATE(a.fecha) >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)";
            }
            else if (fecha === "DOS_MESES") {
                query += " AND DATE(a.fecha) >= DATE_SUB(CURDATE(), INTERVAL 2 MONTH)";
            }
            else if (fecha === "TODOS") {
                query += " AND a.fecha >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)";
            }

        }


        query += " ORDER BY a.fecha DESC, a.hora DESC";

        const [rows] = await db.query(query, params);

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