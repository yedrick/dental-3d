import type { Db } from "../db.js";
import { requestContext } from "./request-context.js";

/**
 * Registra un cambio en audit_logs. Llamar dentro de la misma transacción del cambio.
 * Si la sesión es una suplantación, se agrega quién la hizo (_impersonated_by).
 */
export async function audit(
  tx: Db,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string | null,
  data: unknown,
) {
  await tx.query(
    "INSERT INTO audit_logs (user_id, action, table_name, record_id, data) VALUES (?, ?, ?, ?, ?)",
    [userId, action, tableName, recordId, serialize(data)],
  );
}

function serialize(data: unknown) {
  const impersonatedBy = requestContext.getStore()?.impersonatedBy;
  if (!impersonatedBy) return data == null ? null : JSON.stringify(data);
  const base = data != null && typeof data === "object" && !Array.isArray(data) ? data : { value: data ?? null };
  return JSON.stringify({ ...base, _impersonated_by: impersonatedBy });
}
