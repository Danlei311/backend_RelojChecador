import jwt from "jsonwebtoken";

export const verificarToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];

  if (!authHeader) {
    return res.status(401).json({
      success: false,
      message: "Token no proporcionado"
    });
  }

  // El token viene como: "Bearer xxxxxx"
  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Guardamos los datos del usuario en la request (SESION)
    req.usuario = {
      idUsuario: decoded.idUsuario,
      usuario: decoded.usuario,
      rol: decoded.rol
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
  if (req.usuario.rol !== "ADMIN") {
    return res.status(403).json({
      success: false,
      message: "No tienes permisos para esta acción"
    });
  }
  next();
};
