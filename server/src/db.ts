import type { Pool } from "mysql2";
import type { Pool as PromisePool, PoolConnection, TypeCast } from "mysql2/promise";
import { tenancy } from "./tenancy/index.js";

// TINYINT(1) → boolean y DATE → 'YYYY-MM-DD' (sin conversión de zona horaria), como en PostgreSQL.
// Va por consulta porque el pool lo crea tenancy-node.
const typeCast: TypeCast = (field, next) => {
  if (field.type === "TINY" && field.length === 1) {
    const v = field.string();
    return v === null ? null : v === "1";
  }
  if (field.type === "DATE") return field.string();
  return next();
};

export interface Db {
  query<T = any[]>(sql: string, values?: unknown[]): Promise<T>;
}

function wrap(target: () => Promise<PromisePool | PoolConnection>): Db {
  return {
    async query<T>(sql: string, values: unknown[] = []) {
      const [rows] = await (await target()).query({ sql, values, typeCast });
      return rows as T;
    },
  };
}

/** Pool MySQL de la sucursal actual (lo entrega tenancy-node según el subdominio). */
async function tenantPool(): Promise<PromisePool> {
  return tenancy.pool<Pool>().promise();
}

/** Consultas sobre la base de la sucursal actual. */
export function db(): Db {
  return wrap(tenantPool);
}

/** Ejecuta fn dentro de una transacción en la base de la sucursal; rollback si lanza error. */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const conn = await (await tenantPool()).getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(wrap(async () => conn));
    await conn.commit();
    return result;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
