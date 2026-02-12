import { Router } from "express";
import { login, logout } from "../controllers/auth.controller.js";
import {verificarToken} from "../middlewares/auth.js";

const router = Router();

router.post("/login", login);
router.post("/logout", verificarToken,logout);


export default router;
