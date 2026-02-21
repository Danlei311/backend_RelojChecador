import jwt from "jsonwebtoken";
import { estaEnBlacklist } from "./tokenBlacklist.js";

export const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Token no proporcionado"
    });
  }

  const token = authHeader.split(" ")[1];

  // Revisar si el token ya fue cerrado (logout)
  if (estaEnBlacklist(token)) {
    return res.status(401).json({
      success: false,
      message: "Sesión ya cerrada"
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    req.usuario = {
      idUsuario: decoded.idUsuario,
      usuario: decoded.usuario,
      rol: decoded.rol,
      idPropiedad: decoded.idPropiedad
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Token inválido o expirado"
    });
  }
};

export const soloAdmin = (req, res, next) => {
  if (
    req.usuario.rol === "ADMIN" ||
    req.usuario.rol === "ADMIN_PROPIEDAD"
  ) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: "No tienes permisos para esta acción"
  });
};
