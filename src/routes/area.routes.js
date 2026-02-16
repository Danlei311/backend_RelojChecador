import { Router } from "express";
import {
    crearArea,
    obtenerAreasActivas,
    obtenerAreaPorId,
    actualizarArea,
    eliminarArea
} from "../controllers/area.controller.js";

import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import { areasSSE } from "../sse/areas.sse.js";

const router = Router();

// SSE
router.get("/areas/sse", verificarToken, areasSSE);

// CRUD
router.post("/areas", verificarToken, soloAdmin, crearArea);
router.get("/areas", verificarToken, obtenerAreasActivas);
router.get("/areas/:id", verificarToken, obtenerAreaPorId);
router.put("/areas/:id", verificarToken, soloAdmin, actualizarArea);
router.delete("/areas/:id", verificarToken, soloAdmin, eliminarArea);

export default router;
