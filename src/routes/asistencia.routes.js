import { Router } from 'express';
import { validarPin, subirFoto } from '../controllers/asistencia.controller.js';

const apiRouter = Router();

// ==================================================
// ? Rutas del control de asistencia y incidencias
// Asistencia
apiRouter.post('/validar-pin', validarPin);
apiRouter.post('/subir-foto', subirFoto);
// ==================================================

export default apiRouter;