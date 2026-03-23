import bcrypt from "bcrypt";
import { db } from "../config/database.js";

export const crearSuperUsuarioSiNoExiste = async () => {

  const connection = await db.getConnection();

  try {

    await connection.beginTransaction();

    const adminUser = process.env.DEFAULT_ADMIN_USER;

    // Verificar si ya existe ese usuario
    const [existe] = await connection.query(
      `SELECT idUsuario FROM usuarios WHERE usuario = ? LIMIT 1`,
      [adminUser]
    );

    if (existe.length > 0) {
      return; // ya existe, no hace nada
    }

    console.log("Creando configuración inicial del sistema...");

    // =========================
    // PROPIEDAD
    // =========================
    const [propiedad] = await connection.query(`
      INSERT INTO propiedades (nombre, direccion)
      VALUES (?, 'Default')
    `, [process.env.DEFAULT_PROPIEDAD]);

    // =========================
    // AREA
    // =========================
    const [area] = await connection.query(`
      INSERT INTO areas (nombreArea, descripcion)
      VALUES (?, 'Área inicial')
    `, [process.env.DEFAULT_AREA]);

    // =========================
    // RELACION
    // =========================
    const [pa] = await connection.query(`
      INSERT INTO propiedad_area (idPropiedad, idArea)
      VALUES (?, ?)
    `, [propiedad.insertId, area.insertId]);

    // =========================
    // EMPLEADO
    // =========================
    const [empleado] = await connection.query(`
      INSERT INTO empleados (
        nombre,
        apellidos,
        numeroEmpleado,
        puesto,
        pin,
        idPropiedadArea,
        fechaRegistro
      )
      VALUES (?, ?, ?, ?, ?, ?, CURDATE())
    `, [
      process.env.DEFAULT_ADMIN_NOMBRE,
      process.env.DEFAULT_ADMIN_APELLIDOS,
      process.env.DEFAULT_ADMIN_NUMERO,
      process.env.DEFAULT_ADMIN_PUESTO,
      process.env.DEFAULT_ADMIN_PIN,
      pa.insertId
    ]);

    // =========================
    // PASSWORD HASH
    // =========================
    const hash = await bcrypt.hash(process.env.DEFAULT_ADMIN_PASS, 10);

    // =========================
    // USUARIO
    // =========================
    await connection.query(`
      INSERT INTO usuarios (
        idEmpleado,
        usuario,
        contrasena,
        rol
      )
      VALUES (?, ?, ?, 'ADMIN')
    `, [
      empleado.insertId,
      adminUser,
      hash
    ]);

    await connection.commit();

    console.log("Sistema inicial creado:");
    console.log(`Usuario: ${adminUser}`);
    console.log(`Password: ${process.env.DEFAULT_ADMIN_PASS}`);

  } catch (error) {

    await connection.rollback();
    console.error("Error en seed:", error);

  } finally {
    connection.release();
  }

};