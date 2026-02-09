import { Router } from "express";
import { crearUsuario } from "../controllers/usuarios.controller.js";

const router = Router();

router.post("/usuarios", crearUsuario);

export default router;
