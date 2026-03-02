import { Router } from "express";
import { obtenerAuditoria } from "../controllers/auditoria.controller.js";
import { verificarToken } from "../middlewares/auth.js";

const router = Router();

router.get("/auditoria", verificarToken, obtenerAuditoria);

export default router;