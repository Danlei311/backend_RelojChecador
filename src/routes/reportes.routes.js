import { Router } from "express";
import { obtenerReportesAsistencia, obtenerFotoAsistencia,
    generarReportePDF, generarReporteExcel
 } from "../controllers/reportes.controller.js";

import { verificarToken } from "../middlewares/auth.js";

const router = Router();

router.get("/reportes/asistencia", verificarToken, obtenerReportesAsistencia);
router.get("/reportes/foto/:idAsistencia", verificarToken, obtenerFotoAsistencia);
router.get("/reportes/asistencia/pdf", verificarToken, generarReportePDF);
router.get("/reportes/asistencia/excel", verificarToken, generarReporteExcel);

export default router;
