// Crea (o asciende) el ADMIN de una sucursal desde la terminal:
//   npm run tenant:create-admin -- <sucursal> <email> <username> "<nombre completo>"
// La contraseña se lee de la variable ADMIN_PASSWORD para que no quede en el historial:
//   ADMIN_PASSWORD='Contraseña123!' npm run tenant:create-admin -- sur admin@clinica.com admin "Nombre"
import bcrypt from "bcryptjs";
import { withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { passwordSchema } from "../routes/auth.routes.js";
import { tenancy } from "../tenancy/index.js";

const [tenantId, email, username, fullName] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? "";
if (!tenantId || !email || !username || !fullName || !password) {
  console.error('Uso: ADMIN_PASSWORD=... npm run tenant:create-admin -- <sucursal> <email> <username> "<nombre completo>"');
  process.exit(1);
}
const check = passwordSchema.safeParse(password);
if (!check.success) {
  console.error("Contraseña débil: " + check.error.issues.map((i) => i.message).join(", "));
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
try {
  await tenancy.run(tenantId, () =>
    withTransaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (username, full_name, email, password_hash, approved, active)
         VALUES (?, ?, ?, ?, 1, 1)
         ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), approved = 1, active = 1`,
        [username, fullName, email.toLowerCase(), hash],
      );
      const [{ id }] = await tx.query<{ id: string }[]>("SELECT id FROM users WHERE email = ?", [email.toLowerCase()]);
      await tx.query("INSERT IGNORE INTO user_roles (user_id, role) VALUES (?, 'ADMIN')", [id]);
      await audit(tx, null, "ADMIN_CREATE_CLI", "users", id, { email: email.toLowerCase(), username });
    }),
  );
  console.log(`✔ ADMIN listo en la sucursal "${tenantId}": ${email}`);
} finally {
  await tenancy.close();
}
