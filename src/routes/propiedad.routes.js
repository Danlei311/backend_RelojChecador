import { Router } from "express";
import { crearPropiedad, obtenerPropiedadesActivas, obtenerPropiedadPorId, actualizarPropiedad, 
    eliminarPropiedadCompleta, eliminarSoloPropiedad
 } from "../controllers/propiedad.controller.js";
import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import { propiedadesSSE } from "../sse/propiedad.sse.js";

const router = Router();

// Canal SSE de propiedades
router.get("/propiedades/sse", verificarToken, propiedadesSSE);

// Crear propiedad → requiere login + ser ADMIN
router.post("/propiedades", verificarToken, soloAdmin, crearPropiedad);

// Obtener propiedades activas → solo requiere estar logeado
router.get("/propiedades", verificarToken, obtenerPropiedadesActivas);

router.get("/propiedades/:id", verificarToken, obtenerPropiedadPorId);

router.put("/propiedades/:id", verificarToken, soloAdmin, actualizarPropiedad);

router.delete("/propiedades/:id/completa", verificarToken, soloAdmin, eliminarPropiedadCompleta);

router.delete("/propiedades/:id/solo", verificarToken, soloAdmin, eliminarSoloPropiedad);



export default router;
