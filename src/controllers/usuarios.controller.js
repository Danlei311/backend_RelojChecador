import bcrypt from "bcrypt";
import { db } from "../config/database.js";

export const crearUsuario = async (req, res) => {
  const { idEmpleado, usuario, contrasena, rol } = req.body;

  try {
    // Validar datos
    if (!idEmpleado || !usuario || !contrasena || !rol) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos obligatorios"
      });
    }

    // Verificar que el usuario NO exista
    const [existente] = await db.query(
      "SELECT idUsuario FROM usuarios WHERE usuario = ?",
      [usuario]
    );

    if (existente.length > 0) {
      return res.status(400).json({
        success: false,
        message: "El nombre de usuario ya está en uso"
      });
    }

    // Encriptar contraseña
    const saltRounds = 10;
    const contrasenaHash = await bcrypt.hash(contrasena, saltRounds);

    // Insertar en la base de datos
    const [result] = await db.query(
      `
      INSERT INTO usuarios (idEmpleado, usuario, contrasena, rol, estatus)
      VALUES (?, ?, ?, ?, TRUE)
      `,
      [idEmpleado, usuario, contrasenaHash, rol]
    );

    // 5️⃣ Responder con el id creado
    res.status(201).json({
      success: true,
      message: "Usuario creado correctamente",
      idUsuario: result.insertId
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error al crear usuario"
    });
  }
};
