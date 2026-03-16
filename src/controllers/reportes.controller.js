import fs from "fs";
import path from "path";
import { db } from "../config/database.js";
import PDFDocument from "pdfkit";
import ExcelJS from "exceljs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    const { idAsistencia } = req.params;

    try {

        const [rows] = await db.query(`
            SELECT fotografia
            FROM asistencias
            WHERE idAsistencia = ?
            LIMIT 1
        `, [idAsistencia]);

        if (rows.length === 0 || !rows[0].fotografia) {

            return res.status(404).json({
                success: false,
                message: "Foto no encontrada"
            });

        }

        const ruta = rows[0].fotografia;

        if (!fs.existsSync(ruta)) {

            return res.status(404).json({
                success: false,
                message: "Archivo no existe en servidor"
            });

        }

        return res.sendFile(path.resolve(ruta));

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false
        });

    }

};

export const generarReportePDF = async (req, res) => {

    try {

        const { idPropiedad, idEmpleado, fechaInicio, fechaFin } = req.query;

        const [[propiedad]] = await db.query(
            `SELECT nombre FROM propiedades WHERE idPropiedad = ?`,
            [idPropiedad]
        );

        const nombrePropiedad = propiedad?.nombre ?? idPropiedad;

        let nombreEmpleado = "Todos";

        if (idEmpleado && idEmpleado !== "0") {

            const [[empleado]] = await db.query(
                `SELECT CONCAT(nombre,' ',apellidos) AS nombre
                 FROM empleados
                 WHERE idEmpleado = ?`,
                [idEmpleado]
            );

            if (empleado) nombreEmpleado = empleado.nombre;

        }

        const datos = await obtenerDatosReporte(req);

        const doc = new PDFDocument({
            size: "A4",
            layout: "landscape",
            margin: 40
        });

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=reporte_asistencia_${Date.now()}.pdf`
        );

        doc.pipe(res);

        const azul = "#0B4F6C";

        const logoPath = path.join(__dirname, "../assets/logoPrueba.png");

        doc.image(logoPath, 40, 35, { width: 60 });

        const hoy = new Date().toISOString().slice(0, 10);

        const infoX = doc.page.width - 260;

        doc.fontSize(10).text(`Fecha generación: ${hoy}`, infoX, 40, { width: 220 });
        doc.text(`Propiedad: ${nombrePropiedad}`, infoX, 55, { width: 220 });
        doc.text(`Empleado(s): ${nombreEmpleado}`, infoX, 70, { width: 220 });
        doc.text(`Rango: ${fechaInicio} - ${fechaFin}`, infoX, 85, { width: 220 });

        doc.moveDown(4);

        doc
            .fontSize(18)
            .fillColor(azul)
            .text("Reporte de Asistencias", 0, doc.y, { align: "center" });

        doc.moveDown(2);

        const headers = [
            "Num Emp",
            "Nombre",
            "Puesto",
            "Área",
            "Retardo",
            "Tiempo",
            "Falta",
            "Extemporáneo",
            "Llegada",
            "Salida",
            "Foto"
        ];

        let columnWidths = [
            70, 200, 120, 120, 70, 90, 60, 110, 90, 90, 70
        ];

        const printableWidth =
            doc.page.width - doc.page.margins.left - doc.page.margins.right;

        const totalWidth = columnWidths.reduce((a, b) => a + b, 0);

        const scale = printableWidth / totalWidth;

        columnWidths = columnWidths.map(w => w * scale);

        const tableWidth = columnWidths.reduce((a, b) => a + b, 0);

        const startX = (doc.page.width - tableWidth) / 2;

        let y = doc.y;

        let fechaActual = "";

        const baseRowHeight = 26;

        const dibujarHeaders = () => {

            let x = startX;

            headers.forEach((h, i) => {

                doc.rect(x, y, columnWidths[i], baseRowHeight)
                    .fillAndStroke(azul, "#000");

                doc.fillColor("white")
                    .fontSize(9)
                    .text(h, x + 3, y + 7, {
                        width: columnWidths[i] - 6,
                        align: "center"
                    });

                x += columnWidths[i];

            });

            y += baseRowHeight;

        };

        datos.forEach((r) => {

            const fecha = r.fecha.toISOString().slice(0, 10);

            const row = [
                r.numeroEmpleado,
                r.nombreEmpleado,
                r.puesto,
                r.area,
                r.retardo,
                r.tiempoRetardo,
                r.falta,
                r.extemporaneo,
                r.horaLlegada,
                r.horaSalida,
                r.fotografia ? "SI" : "NO"
            ];

            let rowHeight = baseRowHeight;

            doc.fontSize(9);

            row.forEach((cell, i) => {

                const h = doc.heightOfString(String(cell ?? ""), {
                    width: columnWidths[i] - 8
                });

                if (h + 10 > rowHeight) rowHeight = h + 10;

            });

            if (fecha !== fechaActual) {

                const alturaBloque = 40 + baseRowHeight + rowHeight;

                if (y + alturaBloque > doc.page.height - 60) {
                    doc.addPage();
                    y = 40;
                }

                fechaActual = fecha;

                y += 10;

                doc
                    .fontSize(13)
                    .fillColor("black")
                    .text(`Reporte del día: ${fecha}`, startX, y);

                y = doc.y + 6;

                dibujarHeaders();

            }

            // VERIFICAR ESPACIO ANTES DE DIBUJAR
            if (y + rowHeight > doc.page.height - 60) {

                doc.addPage();

                y = 40;

                dibujarHeaders();

            }

            let color = "#b7f7c4";

            if (r.falta === "SI") color = "#ffb3b3";
            else if (r.retardo === "SI") color = "#fff3b0";
            else if (r.extemporaneo === "SI") color = "#b3d9ff";

            let x = startX;

            row.forEach((cell, i) => {

                doc.rect(x, y, columnWidths[i], rowHeight)
                    .fillAndStroke(color, "#cccccc");

                doc.fillColor("black")
                    .fontSize(9)
                    .text(String(cell ?? ""), x + 4, y + 6, {
                        width: columnWidths[i] - 8,
                        align: "center"
                    });

                x += columnWidths[i];

            });

            y += rowHeight;

        });

        doc.end();

    } catch (error) {

        console.error(error);

        res.status(500).json({ success: false });

    }

};


export const generarReporteExcel = async (req, res) => {

    try {

        const { idPropiedad, idEmpleado, fechaInicio, fechaFin } = req.query;

        const [[propiedad]] = await db.query(
            `SELECT nombre FROM propiedades WHERE idPropiedad = ?`,
            [idPropiedad]
        );

        const nombrePropiedad = propiedad?.nombre ?? idPropiedad;

        let nombreEmpleado = "Todos";

        if (idEmpleado && idEmpleado !== "0") {

            const [[empleado]] = await db.query(
                `SELECT CONCAT(nombre,' ',apellidos) AS nombre
                 FROM empleados
                 WHERE idEmpleado = ?`,
                [idEmpleado]
            );

            if (empleado) nombreEmpleado = empleado.nombre;

        }

        const datos = await obtenerDatosReporte(req);

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Reporte Asistencias");
        const logoId = workbook.addImage({
            filename: path.join(__dirname, "../assets/logoPrueba.png"),
            extension: "png"
        });

        let rowIndex = 1;

        /* ======== ENCABEZADO ======== */

        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 120, height: 60 }
        });

        sheet.getRow(1).height = 45;
        sheet.getRow(2).height = 20;
        sheet.getRow(3).height = 20;

        sheet.mergeCells(`A${rowIndex}:K${rowIndex}`);
        sheet.getCell(`A${rowIndex}`).value = "REPORTE DE ASISTENCIAS";
        sheet.getCell(`A${rowIndex}`).font = { size: 16, bold: true };
        sheet.getCell(`A${rowIndex}`).alignment = { horizontal: "center" };

        rowIndex += 2;

        sheet.getCell(`I${rowIndex}`).value = "Propiedad:";
        sheet.getCell(`J${rowIndex}`).value = nombrePropiedad;

        rowIndex++;

        sheet.getCell(`I${rowIndex}`).value = "Empleado(s):";
        sheet.getCell(`J${rowIndex}`).value = nombreEmpleado;

        rowIndex++;

        sheet.getCell(`I${rowIndex}`).value = "Rango:";
        sheet.getCell(`J${rowIndex}`).value = `${fechaInicio} - ${fechaFin}`;

        rowIndex += 2;

        const headers = [
            "Num Emp",
            "Nombre",
            "Puesto",
            "Área",
            "Retardo",
            "Tiempo",
            "Falta",
            "Extemporáneo",
            "Llegada",
            "Salida",
            "Foto"
        ];

        let fechaActual = "";

        const dibujarHeaders = () => {

            const row = sheet.getRow(rowIndex);

            headers.forEach((h, i) => {

                const cell = row.getCell(i + 1);

                cell.value = h;

                cell.font = { bold: true, color: { argb: "FFFFFFFF" } };

                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: "0B4F6C" }
                };

                cell.alignment = {
                    horizontal: "center",
                    vertical: "middle",
                    wrapText: true
                };

                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" }
                };

            });

            rowIndex++;

        };

        datos.forEach((r) => {

            const fecha = r.fecha.toISOString().slice(0, 10);

            /* ===== SEPARADOR DE FECHA ===== */

            if (fecha !== fechaActual) {

                fechaActual = fecha;

                sheet.mergeCells(`A${rowIndex}:K${rowIndex}`);

                const cell = sheet.getCell(`A${rowIndex}`);

                cell.value = `Reporte del día: ${fecha}`;
                cell.font = { bold: true, size: 12 };

                rowIndex++;

                dibujarHeaders();

            }

            const row = sheet.getRow(rowIndex);

            const values = [
                r.numeroEmpleado,
                r.nombreEmpleado,
                r.puesto,
                r.area,
                r.retardo,
                r.tiempoRetardo,
                r.falta,
                r.extemporaneo,
                r.horaLlegada,
                r.horaSalida,
                r.fotografia ? "SI" : "NO"
            ];

            let color = "B7F7C4";

            if (r.falta === "SI") color = "FFB3B3";
            else if (r.retardo === "SI") color = "FFF3B0";
            else if (r.extemporaneo === "SI") color = "B3D9FF";

            values.forEach((v, i) => {

                const cell = row.getCell(i + 1);

                cell.value = v;

                cell.alignment = {
                    horizontal: "center",
                    vertical: "middle",
                    wrapText: true
                };

                cell.fill = {
                    type: "pattern",
                    pattern: "solid",
                    fgColor: { argb: color }
                };

                cell.border = {
                    top: { style: "thin" },
                    left: { style: "thin" },
                    bottom: { style: "thin" },
                    right: { style: "thin" }
                };

            });

            rowIndex++;

        });

        /* ===== AUTO WIDTH ===== */

        sheet.columns = [
            { width: 15 },
            { width: 30 },
            { width: 20 },
            { width: 20 },
            { width: 10 },
            { width: 15 },
            { width: 10 },
            { width: 15 },
            { width: 15 },
            { width: 15 },
            { width: 10 }
        ];

        /* ===== DESCARGA ===== */

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename=reporte_asistencia_${Date.now()}.xlsx`
        );

        await workbook.xlsx.write(res);

        res.end();

    } catch (error) {

        console.error(error);

        res.status(500).json({ success: false });

    }

};

const obtenerDatosReporte = async (req) => {

    const { idPropiedad, idEmpleado, fechaInicio, fechaFin } = req.query;

    if (!fechaInicio || !fechaFin) {
        throw new Error("Debe enviar fechaInicio y fechaFin");
    }

    if (!idPropiedad) {
        throw new Error("Debe enviar idPropiedad");
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

    return rows;

};