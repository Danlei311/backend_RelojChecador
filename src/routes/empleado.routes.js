import { Router } from "express";
import {
    crearEmpleado,
    obtenerEmpleadosActivos,
    obtenerAreasPropiedadParaEmpleado,
    obtenerEmpleadoPorId,
    actualizarEmpleado,
    eliminarEmpleado
} from "../controllers/empleado.controller.js";

import { verificarToken, soloAdmin } from "../middlewares/auth.js";
import { empleadosSSE } from "../sse/empleados.sse.js";

const router = Router();

router.get("/empleados/sse", verificarToken, empleadosSSE);

router.post("/empleados", verificarToken, soloAdmin, crearEmpleado);
router.get("/empleados", verificarToken, obtenerEmpleadosActivos);
router.get("/empleados/areas-propiedad", verificarToken, obtenerAreasPropiedadParaEmpleado);
router.get("/empleados/:id", verificarToken, obtenerEmpleadoPorId);
router.put("/empleados/:id", verificarToken, soloAdmin, actualizarEmpleado);
router.delete("/empleados/:id", verificarToken, soloAdmin, eliminarEmpleado);


export default router;
