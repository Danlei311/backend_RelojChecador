import { Router } from 'express';
import { getServerTime } from '../controllers/reloj.controller.js';

const apiRouter = Router();

// ==================================================
// ? Rutas del reloj checador
apiRouter.get('/time', getServerTime);
// ==================================================

export default apiRouter;