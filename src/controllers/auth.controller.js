import jwt from "jsonwebtoken";

const SECRET = "MI_SUPER_SECRETO"; // luego lo pones en .env

export const login = async (req, res) => {
    const { usuario, contrasena } = req.body;

    try {
        const [rows] = await db.query(`
            SELECT idUsuario, idEmpleado, usuario, rol, contrasena, estatus
            FROM usuarios
            WHERE usuario = ?
        `, [usuario]);

        if (rows.length === 0) {
            return res.status(401).json({ success: false, message: "Usuario no encontrado" });
        }

        const user = rows[0];

        if (contrasena !== user.contrasena) {
            return res.status(401).json({ success: false, message: "Contraseña incorrecta" });
        }

        if (!user.estatus) {
            return res.status(403).json({ success: false, message: "Usuario inactivo" });
        }

        // 🔹 Generar token (válido por 8 horas)
        const token = jwt.sign(
            {
                idUsuario: user.idUsuario,
                idEmpleado: user.idEmpleado,
                rol: user.rol
            },
            SECRET,
            { expiresIn: "8h" }
        );

        res.json({
            success: true,
            token,
            usuario: user.usuario,
            rol: user.rol
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "Error en login" });
    }
};
