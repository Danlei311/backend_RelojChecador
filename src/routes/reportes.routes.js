import { Router } from "express";
import { obtenerReportesAsistencia, obtenerFotoAsistencia } from "../controllers/reportes.controller.js";

import { verificarToken } from "../middlewares/auth.js";

const router = Router();

router.get("/reportes/asistencia", verificarToken, obtenerReportesAsistencia);
router.get("/reportes/foto/:idAsistencia", verificarToken, obtenerFotoAsistencia);

export default router;
