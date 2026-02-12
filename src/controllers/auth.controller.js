import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { db } from "../config/database.js";
import {agregarTokenABlacklist} from "../middlewares/tokenBlacklist.js";

export const login = async (req, res) => {
  const { usuario, password } = req.body;

  try {
    // Verificar campos vacíos
    if (!usuario || !password) {
      return res.status(400).json({
        success: false,
        message: "Usuario y contraseña son obligatorios"
      });
    }

    // Buscar usuario
    const [rows] = await db.query(
      "SELECT idUsuario, usuario, contrasena, rol, estatus FROM usuarios WHERE usuario = ?",
      [usuario]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado"
      });
    }

    const user = rows[0];

    // Verificar que esté activo
    if (user.estatus !== 1) {
      return res.status(403).json({
        success: false,
        message: "Usuario inactivo"
      });
    }

    // Comparar contraseña hasheada
    const passwordValida = await bcrypt.compare(password, user.contrasena);

    if (!passwordValida) {
      return res.status(401).json({
        success: false,
        message: "Contraseña incorrecta"
      });
    }

    // Generar TOKEN JWT con datos para sesión y auditoría
    const token = jwt.sign(
      {
        idUsuario: user.idUsuario,
        usuario: user.usuario,
        rol: user.rol
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "8h" }
    );

    // Respuesta al frontend
    res.json({
      success: true,
      token,
      usuario: {
        id: user.idUsuario,
        usuario: user.usuario,
        rol: user.rol
      }
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error en el servidor al iniciar sesión"
    });
  }
};

export const logout = async (req, res) => {
  try {
    const authHeader = req.headers["authorization"];

    if (!authHeader) {
      return res.status(400).json({
        success: false,
        message: "No se proporcionó token"
      });
    }

    const token = authHeader.split(" ")[1];

    // Agregamos el token a la blacklist
    agregarTokenABlacklist(token);

    res.status(200).json({
      success: true,
      message: "Sesión cerrada correctamente"
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al cerrar sesión"
    });
  }
};