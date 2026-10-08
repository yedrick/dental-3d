import type { Conn } from "../db.js";

/** Registra un cambio en audit_logs. Llamar dentro de la misma transacción del cambio. */
export async function audit(
  conn: Conn,
  userId: string | null,
  action: string,
  tableName: string,
  recordId: string | null,
  data: unknown,
) {
  await conn.execute(
    "INSERT INTO audit_logs (user_id, action, table_name, record_id, data) VALUES (?, ?, ?, ?, ?)",
    [userId, action, tableName, recordId, data == null ? null : JSON.stringify(data)],
  );
}
