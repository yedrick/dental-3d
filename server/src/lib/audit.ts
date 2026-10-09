import type { Db } from "../db.js";

/** Registra un cambio en audit_logs. Llamar dentro de la misma transacción del cambio. */
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
    [userId, action, tableName, recordId, data == null ? null : JSON.stringify(data)],
  );
}
