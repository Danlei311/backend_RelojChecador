import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

async function test() {
  try {
    const conn = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      port: Number(process.env.DB_PORT)
    });

    console.log("✅ CONEXIÓN EXITOSA A MYSQL DESDE NODE");
    await conn.close();
  } catch (err) {
    console.error("❌ ERROR CONECTANDO A MYSQL:", err);
  }
}

test();
