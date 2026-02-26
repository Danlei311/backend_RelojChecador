import { Router } from "express";
import { crearUsuario, obtenerUsuariosActivos,
    obtenerUsuarioPorId,
    actualizarUsuario,
    eliminarUsuario
 } from "../controllers/usuarios.controller.js";

import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import { usuariosSSE } from "../sse/usuarios.sse.js";

const router = Router();

router.get("/usuarios/sse", verificarToken, usuariosSSE);
router.post("/usuarios", verificarToken, soloAdmin, crearUsuario);
router.get("/usuarios", verificarToken, obtenerUsuariosActivos);
router.get("/usuarios/:id", verificarToken, obtenerUsuarioPorId);
router.put("/usuarios/:id", verificarToken, soloAdmin, actualizarUsuario);
router.delete("/usuarios/:id", verificarToken, soloAdmin, eliminarUsuario);

export default router;