// Crea (o asciende) un usuario ADMIN aprobado desde la terminal:
//   npm run db:create-admin -- <email> <username> "<nombre completo>" <contraseña>
import bcrypt from "bcryptjs";
import { pool, withTransaction } from "../db.js";
import { passwordSchema } from "../routes/auth.routes.js";

const [email, username, fullName, password] = process.argv.slice(2);
if (!email || !username || !fullName || !password) {
  console.error('Uso: npm run db:create-admin -- <email> <username> "<nombre completo>" <contraseña>');
  process.exit(1);
}
const check = passwordSchema.safeParse(password);
if (!check.success) {
  console.error("Contraseña débil: " + check.error.issues.map((i) => i.message).join(", "));
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
await withTransaction(async (conn) => {
  await conn.execute(
    `INSERT INTO users (username, full_name, email, password_hash, approved, active)
     VALUES (?, ?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), approved = 1, active = 1`,
    [username, fullName, email.toLowerCase(), hash],
  );
  await conn.execute(
    "INSERT IGNORE INTO user_roles (user_id, role) SELECT id, 'ADMIN' FROM users WHERE email = ?",
    [email.toLowerCase()],
  );
});
console.log(`✔ ADMIN listo: ${email}`);
await pool.end();
