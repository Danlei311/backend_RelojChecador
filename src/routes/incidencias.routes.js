import { Router } from "express";
import { soloAdmin, verificarToken } from "../middlewares/auth.js";
import { obtenerIncidencias, justificarIncidencia } from "../controllers/incidencias.controller.js";
import { incidenciasSSE } from "../sse/incidencias.sse.js";

const router = Router();

// SSE
router.get("/incidencias/sse", verificarToken, incidenciasSSE);

router.get("/incidencias", verificarToken, obtenerIncidencias);
router.put("/incidencias/:id/justificar", verificarToken, soloAdmin,justificarIncidencia);

export default router;