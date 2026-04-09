import { Router } from 'express';
import { registrarAsistenciaOffline, subirFotoOffline, buscarAsistenciaPorPin } from '../controllers/offline.controller.js';

const apiRouter = Router();

// Ruta para registro offline
apiRouter.post("/validar-pin-offline", registrarAsistenciaOffline);
apiRouter.post("/subir-foto-offline", subirFotoOffline);

apiRouter.get("/buscar-asistencia", buscarAsistenciaPorPin);


export default apiRouter;