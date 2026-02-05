import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { db } from './src/config/database.js';
import timeRoutes from './src/routes/reloj.routes.js';
import asistenciaRoutes from './src/routes/asistencia.routes.js';


// Configuración de variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());

// Ruta base
app.get('/', (req, res) => {
    res.json({
        message: 'API Reloj Checador funcionando',
        version: '1.0.0',
        status: 'online'
    });
});

// Rutas API
app.use('/api', timeRoutes);
app.use('/api',asistenciaRoutes)

// Servidor
app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});