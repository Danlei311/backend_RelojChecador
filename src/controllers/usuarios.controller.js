import bcrypt from "bcrypt";
import { db } from "../config/database.js";
import { notificarCambioUsuarios } from "../sse/usuarios.sse.js";

const generarContrasenaAutomatica = (empleado) => {
  const nombre = empleado.nombre.substring(0, 2);
  const apellido = empleado.apellidos.substring(0, 2);
  const year = new Date().getFullYear();
  const idParte = String(empleado.idEmpleado).padStart(3, "0");

  return `${nombre}${apellido}${year}${idParte}`;
};

export const crearUsuario = async (req, res) => {

  const { idEmpleado, usuario, rol } = req.body;
  const usuarioLogeado = req.usuario;
  const connection = await db.getConnection();

  try {

    if (!idEmpleado || !usuario || !rol) {
      return res.status(400).json({
        success: false,
        message: "Faltan datos obligatorios"
      });
    }

    if (usuarioLogeado.rol === "LECTURA") {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos"
      });
    }

    await connection.beginTransaction();

    // Verificar que empleado exista y obtener propiedad
    const [empleadoRows] = await connection.query(`
            SELECT 
                e.idEmpleado,
                e.nombre,
                e.apellidos,
                p.idPropiedad
            FROM empleados e
            LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
            LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE e.idEmpleado = ?
              AND e.estatus = TRUE
        `, [idEmpleado]);

    if (empleadoRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Empleado no encontrado"
      });
    }

    const empleado = empleadoRows[0];

    // Validación por propiedad
    if (
      usuarioLogeado.rol === "ADMIN_PROPIEDAD" &&
      empleado.idPropiedad != usuarioLogeado.idPropiedad
    ) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "No puedes crear usuarios de otra propiedad"
      });
    }

    // Verificar que no tenga usuario ya
    const [existeUsuario] = await connection.query(
      "SELECT idUsuario FROM usuarios WHERE idEmpleado = ?",
      [idEmpleado]
    );

    if (existeUsuario.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "El empleado ya tiene usuario"
      });
    }

    // Verificar que username no exista
    const [usernameExiste] = await connection.query(
      "SELECT idUsuario FROM usuarios WHERE usuario = ?",
      [usuario]
    );

    if (usernameExiste.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "El nombre de usuario ya está en uso"
      });
    }

    // Generar contraseña automática
    const contrasenaGenerada = generarContrasenaAutomatica(empleado);

    const saltRounds = 10;
    const contrasenaHash = await bcrypt.hash(contrasenaGenerada, saltRounds);

    // Insertar usuario
    const [result] = await connection.query(`
            INSERT INTO usuarios (idEmpleado, usuario, contrasena, rol, estatus)
            VALUES (?, ?, ?, ?, TRUE)
        `, [idEmpleado, usuario, contrasenaHash, rol]);

    const idUsuario = result.insertId;

    // Auditoría
    await connection.query(`
            INSERT INTO auditoria (idUsuario, accion, fecha, hora)
            VALUES (?, ?, CURDATE(), CURTIME())
        `, [
      usuarioLogeado.idUsuario,
      `${usuarioLogeado.usuario} creó el usuario ${usuario}`
    ]);

    await connection.commit();

    // SSE
    notificarCambioUsuarios("usuario-creado", {
      idUsuario,
      usuario,
      rol,
      nombreCompleto: `${empleado.nombre} ${empleado.apellidos}`,
      idPropiedad: empleado.idPropiedad,
      estatus: 1
    });

    res.status(201).json({
      success: true,
      idUsuario,
      contrasenaTemporal: contrasenaGenerada
    });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false });
  } finally {
    connection.release();
  }
};

export const obtenerUsuariosActivos = async (req, res) => {

  try {

    let query = `
      SELECT 
        u.idUsuario,
        u.usuario,
        u.rol,
        u.estatus,
        CONCAT(e.nombre, ' ', e.apellidos) AS nombreCompleto,
        p.idPropiedad
      FROM usuarios u
      LEFT JOIN empleados e ON e.idEmpleado = u.idEmpleado
      LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
      LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
      WHERE u.estatus = TRUE
    `;

    let params = [];

    // FILTRO MANUAL SOLO ADMIN
    if (req.query.idPropiedad && req.usuario.rol === "ADMIN") {
      query += " AND p.idPropiedad = ?";
      params.push(req.query.idPropiedad);
    }

    // FILTRO AUTOMÁTICO POR ROL
    if (req.usuario.rol === "ADMIN_PROPIEDAD" || req.usuario.rol === "LECTURA") {
      query += " AND p.idPropiedad = ?";
      params.push(req.usuario.idPropiedad);
    }

    query += " ORDER BY u.usuario ASC";

    const [usuarios] = await db.query(query, params);

    res.status(200).json({
      success: true,
      total: usuarios.length,
      data: usuarios
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
};

// OBTENER USUARIO POR ID
export const obtenerUsuarioPorId = async (req, res) => {

  const { id } = req.params;

  try {

    let query = `
            SELECT 
                u.idUsuario,
                u.usuario,
                u.rol,
                u.estatus,
                u.idEmpleado,
                CONCAT(e.nombre, ' ', e.apellidos) AS nombreCompleto,
                p.idPropiedad
            FROM usuarios u
            LEFT JOIN empleados e ON e.idEmpleado = u.idEmpleado
            LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
            LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
            WHERE u.idUsuario = ?
        `;

    let params = [id];

    // FILTRO POR PROPIEDAD
    if (
      req.usuario.rol === "ADMIN_PROPIEDAD" ||
      req.usuario.rol === "LECTURA"
    ) {
      query += " AND p.idPropiedad = ?";
      params.push(req.usuario.idPropiedad);
    }

    query += " LIMIT 1";

    const [rows] = await db.query(query, params);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado"
      });
    }

    res.status(200).json({
      success: true,
      data: rows[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false });
  }
};

// ACTUALIZAR USUARIO
export const actualizarUsuario = async (req, res) => {

  const { id } = req.params;
  const { usuario, rol } = req.body;
  const usuarioLogeado = req.usuario;

  const connection = await db.getConnection();

  try {

    if (!usuario || !rol) {
      return res.status(400).json({
        success: false,
        message: "Usuario y rol son obligatorios"
      });
    }

    await connection.beginTransaction();

    // Verificar existencia y propiedad
    const [rows] = await connection.query(`
      SELECT 
        u.idUsuario,
        u.usuario AS usuarioActual,
        u.rol AS rolActual,
        p.idPropiedad,
        CONCAT(e.nombre, ' ', e.apellidos) AS nombreCompleto
      FROM usuarios u
      LEFT JOIN empleados e ON e.idEmpleado = u.idEmpleado
      LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
      LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
      WHERE u.idUsuario = ?
    `, [id]);

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado"
      });
    }

    const usuarioDB = rows[0];

    // Validaciones de rol
    if (usuarioLogeado.rol === "LECTURA") {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para actualizar usuarios"
      });
    }

    if (
      usuarioLogeado.rol === "ADMIN_PROPIEDAD" &&
      usuarioDB.idPropiedad != usuarioLogeado.idPropiedad
    ) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "No puedes modificar usuarios de otra propiedad"
      });
    }

    // Verificar username duplicado
    const [usernameExiste] = await connection.query(
      "SELECT idUsuario FROM usuarios WHERE usuario = ? AND idUsuario != ?",
      [usuario, id]
    );

    if (usernameExiste.length > 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "El nombre de usuario ya está en uso"
      });
    }

    // Actualizar
    await connection.query(`
      UPDATE usuarios
      SET usuario = ?, rol = ?
      WHERE idUsuario = ?
    `, [usuario, rol, id]);

    // Auditoría
    await connection.query(`
      INSERT INTO auditoria (idUsuario, accion, fecha, hora)
      VALUES (?, ?, CURDATE(), CURTIME())
    `, [
      usuarioLogeado.idUsuario,
      `${usuarioLogeado.usuario} actualizó el usuario ${usuarioDB.usuarioActual} (ID: ${id})`
    ]);

    await connection.commit();

    // SSE
    notificarCambioUsuarios("usuario-actualizado", {
      idUsuario: parseInt(id),
      usuario,
      rol,
      nombreCompleto: usuarioDB.nombreCompleto,
      idPropiedad: usuarioDB.idPropiedad,
      estatus: 1
    });

    res.status(200).json({ success: true });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false });
  } finally {
    connection.release();
  }
};

// ELIMINACIÓN LÓGICA
export const eliminarUsuario = async (req, res) => {

  const { id } = req.params;
  const usuarioLogeado = req.usuario;

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    // Verificar existencia y propiedad
    const [rows] = await connection.query(`
      SELECT 
        u.idUsuario,
        u.usuario,
        p.idPropiedad
      FROM usuarios u
      LEFT JOIN empleados e ON e.idEmpleado = u.idEmpleado
      LEFT JOIN propiedad_area pa ON pa.idPropiedadArea = e.idPropiedadArea
      LEFT JOIN propiedades p ON p.idPropiedad = pa.idPropiedad
      WHERE u.idUsuario = ?
    `, [id]);

    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Usuario no encontrado"
      });
    }

    const usuarioDB = rows[0];

    // Validaciones
    if (usuarioLogeado.rol === "LECTURA") {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para eliminar usuarios"
      });
    }

    if (
      usuarioLogeado.rol === "ADMIN_PROPIEDAD" &&
      usuarioDB.idPropiedad != usuarioLogeado.idPropiedad
    ) {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "No puedes eliminar usuarios de otra propiedad"
      });
    }

    // Evitar que se elimine a sí mismo
    if (usuarioLogeado.idUsuario == id) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "No puedes desactivar tu propio usuario"
      });
    }

    // Desactivar
    await connection.query(`
      UPDATE usuarios
      SET estatus = FALSE
      WHERE idUsuario = ?
    `, [id]);

    // Auditoría
    await connection.query(`
      INSERT INTO auditoria (idUsuario, accion, fecha, hora)
      VALUES (?, ?, CURDATE(), CURTIME())
    `, [
      usuarioLogeado.idUsuario,
      `${usuarioLogeado.usuario} desactivó el usuario ${usuarioDB.usuario} (ID: ${id})`
    ]);

    await connection.commit();

    // SSE
    notificarCambioUsuarios("usuario-eliminado", {
      idUsuario: parseInt(id),
      estatus: 0
    });

    res.status(200).json({ success: true });

  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false });
  } finally {
    connection.release();
  }
};