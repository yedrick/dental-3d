import mysql from "mysql2/promise";
import { config } from "./config.js";

export const pool = mysql.createPool({
  ...config.db,
  connectionLimit: 10,
  timezone: "Z",
  dateStrings: ["DATE"],
  decimalNumbers: true,
  // TINYINT(1) -> boolean, como en PostgreSQL
  typeCast(field, next) {
    if (field.type === "TINY" && field.length === 1) {
      const v = field.string();
      return v === null ? null : v === "1";
    }
    return next();
  },
});

export type Conn = mysql.PoolConnection;

/** Ejecuta fn dentro de una transacción; hace rollback si lanza error. */
export async function withTransaction<T>(fn: (conn: Conn) => Promise<T>): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
