import { Router } from "express";
import {
    crearHorario,
    obtenerHorariosActivos,
    obtenerAreasDisponiblesParaHorario,
    obtenerHorarioPorId,
    actualizarHorario,
    eliminarHorario
} from "../controllers/horario.controller.js";

import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import { horariosSSE } from "../sse/horarios.sse.js";

const router = Router();

router.get("/horarios/sse", verificarToken, horariosSSE);

router.post("/horarios", verificarToken, soloAdmin, crearHorario);
router.get("/horarios", verificarToken, obtenerHorariosActivos);
router.put("/horarios/:id", verificarToken, soloAdmin, actualizarHorario);
router.delete("/horarios/:id", verificarToken, soloAdmin, eliminarHorario);

router.get('/horarios/areas-disponibles', verificarToken, obtenerAreasDisponiblesParaHorario);

router.get("/horarios/:id", verificarToken, obtenerHorarioPorId);

export default router;
