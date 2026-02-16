import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import timeRoutes from './src/routes/reloj.routes.js';
import asistenciaRoutes from './src/routes/asistencia.routes.js';
import authRoutes from './src/routes/auth.routes.js';
import usuarioRoutes from './src/routes/usuarios.routes.js';
import propiedadRoutes from './src/routes/propiedad.routes.js';
import areaRoutes from './src/routes/area.routes.js';


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
app.use('/api', authRoutes)
app.use('/api', usuarioRoutes);
app.use('/api', propiedadRoutes);
app.use('/api', areaRoutes);

// Servidor
// QUE ACEPTE CONEXIONES EXTERNAS
app.listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
