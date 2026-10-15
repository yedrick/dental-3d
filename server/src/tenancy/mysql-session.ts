import type { Pool, PoolConnection } from "mysql2";
import type { DatabaseDriver } from "@tenancy-node/db";
import { mysql } from "@tenancy-node/db-mysql";

/**
 * Driver MySQL de tenancy-node con la sesión de cada conexión fijada por la app:
 * - time_zone UTC: created_at (DEFAULT CURRENT_TIMESTAMP) se guarda en UTC aunque el servidor
 *   MySQL esté en otra zona (p. ej. un MySQL local en hora de Bolivia).
 * - sql_mode estricto: un dato inválido da error en vez de guardarse recortado o en cero.
 *   ONLY_FULL_GROUP_BY solo en MySQL: MariaDB no reconoce las columnas que dependen de la clave
 *   primaria y rechaza consultas válidas (GROUP BY u.id con u.nombre…). En MySQL sigue activo y
 *   detecta los GROUP BY ambiguos en desarrollo.
 * Se aplica solo a las conexiones de esta app (base central, sucursales, migraciones y seed):
 * no cambia nada global del servidor ni de otras bases que convivan en él.
 */
const STRICT = "STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION";
const SESSION_SQL =
  `SET time_zone = '+00:00', sql_mode = IF(VERSION() LIKE '%MariaDB%', '${STRICT}', 'ONLY_FULL_GROUP_BY,${STRICT}')`;

export function mysqlWithSession(): DatabaseDriver {
  const base = mysql();
  return {
    ...base,
    connect(connection, pool) {
      const opened = base.connect(connection, pool);
      // El pool crea las conexiones al primer uso, así que el listener llega antes que cualquier consulta.
      // mysql2 encola los comandos de cada conexión: el SET corre antes de lo que pida quien la tomó.
      (opened.native as Pool).on("connection", (conn: PoolConnection) => {
        conn.query(SESSION_SQL, (error) => error && pool.onError?.(error));
      });
      return opened;
    },
  };
}
