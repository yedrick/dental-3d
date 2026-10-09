import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { cache } from "../lib/cache.js";
import { HttpError } from "../lib/http-error.js";
import { ROLES } from "../lib/permissions.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Matriz de permisos por rol. ADMIN siempre tiene todos y no se edita.
export const rolesRouter = Router();
rolesRouter.use(requireAuth);

rolesRouter.get("/", requirePermission("view.roles"), async (_req, res) => {
  const [permissions, rows] = await Promise.all([
    db().query("SELECT `key`, description, category FROM permissions ORDER BY category, `key`"),
    db().query<{ role: string; permission_key: string }[]>("SELECT role, permission_key FROM role_permissions"),
  ]);
  const matrix: Record<string, string[]> = Object.fromEntries(ROLES.map((r) => [r, []]));
  for (const r of rows) matrix[r.role]?.push(r.permission_key);
  matrix.ADMIN = (permissions as { key: string }[]).map((p) => p.key);
  res.json({ roles: ROLES, permissions, matrix });
});

const editableRole = z.enum(ROLES).refine((r) => r !== "ADMIN", "El rol ADMIN siempre tiene todos los permisos");

async function setPermission(userId: string, role: string, key: string, granted: boolean) {
  await withTransaction(async (tx) => {
    const [perm] = await tx.query("SELECT `key` FROM permissions WHERE `key` = ?", [key]);
    if (!perm) throw new HttpError(404, "Permiso no encontrado");
    if (granted) await tx.query("INSERT IGNORE INTO role_permissions (role, permission_key) VALUES (?, ?)", [role, key]);
    else await tx.query("DELETE FROM role_permissions WHERE role = ? AND permission_key = ?", [role, key]);
    await audit(tx, userId, granted ? "PERMISSION_GRANT" : "PERMISSION_REVOKE", "role_permissions", `${role}:${key}`, { role, key });
  });
  // Los permisos están en la caché de sesiones y de roles: se vacía la caché de la sucursal
  // para que el cambio valga en la siguiente petición (es una operación poco frecuente).
  await cache().flush();
}

rolesRouter.put("/:role/permissions/:key", requirePermission("roles.manage_permissions"), async (req, res) => {
  const role = editableRole.parse(req.params.role);
  await setPermission(req.user!.id, role, String(req.params.key), true);
  res.json({ role, key: req.params.key, granted: true });
});

rolesRouter.delete("/:role/permissions/:key", requirePermission("roles.manage_permissions"), async (req, res) => {
  const role = editableRole.parse(req.params.role);
  await setPermission(req.user!.id, role, String(req.params.key), false);
  res.json({ role, key: req.params.key, granted: false });
});
