import { createPool, type Pool, type RowDataPacket } from "mysql2/promise";
import { MemoryErrorTracker, type ErrorSummary, type ErrorTracker, type TrackedError } from "@tenancy-node/core";

/**
 * Errores de la plataforma y de cada sucursal (500 de la API, fallas de tenancy-node) guardados en la
 * base central, tabla app_error_log. El panel /admin los muestra en "Errores" y en el detalle de cada
 * sucursal.
 *
 * El registro de tenancy-node solo está en memoria: se pierde al reiniciar y, con API_PROCESSES > 1,
 * cada proceso ve solo los suyos. Aquí cada error se guarda en MySQL y cada proceso trae cada pocos
 * segundos los de los demás. La interfaz de tenancy-node es síncrona, así que se lee de una copia en
 * memoria (últimos PER_TENANT por sucursal) y el resumen se calcula en MySQL.
 */
const TABLE = "app_error_log";
const PER_TENANT = 200;
const POLL_MS = 10_000;
const RETENTION_DAYS = 30;
const CLEANUP_EVERY_MS = 6 * 3600_000;
const MAX_SEEN = 20_000;

const cut = (v: string | undefined, n: number) => (v && v.length > n ? v.slice(0, n) : v ?? null);

interface Row extends RowDataPacket {
  id: string;
  tenant_id: string | null;
  operation: string;
  code: string;
  name: string;
  message: string;
  stack: string | null;
  context: string | null;
  time: Date;
}

export class PersistentErrorTracker implements ErrorTracker {
  private readonly memory = new MemoryErrorTracker({ perTenant: PER_TENANT });
  /** Ids ya cargados en memoria (los propios y los de otros procesos), para no repetirlos. */
  private readonly seen = new Set<string>();
  private cachedSummary: ErrorSummary[] = [];
  private pool: Pool | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastTime = new Date(0);
  private lastCleanup = 0;
  private ready = false;

  constructor(private readonly databaseUrl: string) {}

  /** Lo llama solo la API (server.ts): la CLI y los scripts usan el registro en memoria. */
  start() {
    if (this.pool) return;
    // timezone 'Z': las fechas se guardan y leen en UTC
    this.pool = createPool({ uri: this.databaseUrl, connectionLimit: 2, timezone: "Z" });
    void this.sync();
    this.timer = setInterval(() => void this.sync(), POLL_MS);
    this.timer.unref();
  }

  async close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pool?.end().catch(() => undefined);
    this.pool = null;
  }

  record(error: TrackedError) {
    this.remember(error);
    this.bump(error);
    if (!this.pool) return;
    const pool = this.pool;
    void (async () => {
      try {
        await this.ensureTable();
        await pool.query(
          `INSERT IGNORE INTO ${TABLE} (id, tenant_id, operation, code, name, message, stack, context, time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            error.id, error.tenantId, cut(error.operation, 100), cut(error.code, 100), cut(error.name, 100),
            cut(error.message, 2000), cut(error.stack, 8000), cut(JSON.stringify(error.context ?? {}), 4000), error.time,
          ],
        );
      } catch (e) {
        // Sin recursión: si la base central falla, el error ya quedó en memoria y en el log
        console.error("[errores] no se pudo guardar el error en la base central:", (e as Error).message);
      }
    })();
  }

  recent(options?: { tenantId?: string | null; limit?: number }) {
    return this.memory.recent(options);
  }

  summary() {
    return this.cachedSummary;
  }

  clear(tenantId?: string | null) {
    this.memory.clear(tenantId);
    this.cachedSummary = tenantId === undefined ? [] : this.cachedSummary.filter((s) => s.tenantId !== tenantId);
    if (!this.pool) return;
    const sql = tenantId === undefined ? `DELETE FROM ${TABLE}` : `DELETE FROM ${TABLE} WHERE tenant_id <=> ?`;
    this.pool.query(sql, tenantId === undefined ? [] : [tenantId]).catch((e) => console.error("[errores] no se pudo borrar:", e.message));
  }

  private remember(error: TrackedError) {
    if (this.seen.has(error.id)) return;
    this.seen.add(error.id);
    if (this.seen.size > MAX_SEEN) this.seen.delete(this.seen.values().next().value!);
    this.memory.record(error);
  }

  /** Suma el error al resumen al instante (el próximo sync lo recalcula en MySQL). */
  private bump(error: TrackedError) {
    const s = this.cachedSummary.find((x) => x.tenantId === error.tenantId);
    const next: ErrorSummary = {
      tenantId: error.tenantId,
      total: (s?.total ?? 0) + 1,
      byCode: { ...s?.byCode, [error.code]: (s?.byCode[error.code] ?? 0) + 1 },
      lastErrorAt: error.time,
    };
    this.cachedSummary = [next, ...this.cachedSummary.filter((x) => x !== s)].sort((a, b) => b.total - a.total);
  }

  private async ensureTable() {
    if (this.ready || !this.pool) return;
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      id        CHAR(26)     NOT NULL PRIMARY KEY,
      tenant_id VARCHAR(64)  NULL,
      operation VARCHAR(100) NOT NULL,
      code      VARCHAR(100) NOT NULL,
      name      VARCHAR(100) NOT NULL,
      message   TEXT         NOT NULL,
      stack     TEXT         NULL,
      context   TEXT         NULL,
      time      DATETIME(3)  NOT NULL,
      KEY app_error_log_time_idx (time),
      KEY app_error_log_tenant_time_idx (tenant_id, time)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    this.ready = true;
  }

  /** Trae los errores nuevos de todos los procesos, recalcula el resumen y borra los de más de 30 días. */
  private async sync() {
    if (!this.pool) return;
    try {
      await this.ensureTable();
      const first = this.lastTime.getTime() === 0;
      // Al arrancar: los últimos 30 días. Después: desde el último visto (con margen por relojes de otros procesos)
      const since = first ? new Date(Date.now() - RETENTION_DAYS * 864e5) : new Date(this.lastTime.getTime() - 5_000);
      const [rows] = await this.pool.query<Row[]>(
        `SELECT * FROM ${TABLE} WHERE time >= ? ORDER BY time ${first ? "DESC LIMIT 5000" : "ASC"}`,
        [since],
      );
      const ordered = first ? rows.reverse() : rows;
      for (const r of ordered) {
        this.remember({
          id: r.id, tenantId: r.tenant_id, operation: r.operation, code: r.code, name: r.name, message: r.message,
          stack: r.stack ?? undefined, time: r.time, context: safeJson(r.context),
        });
        if (r.time > this.lastTime) this.lastTime = r.time;
      }
      if (first && this.lastTime.getTime() === 0) this.lastTime = new Date(Date.now() - 60_000);

      const [sum] = await this.pool.query<RowDataPacket[]>(
        `SELECT tenant_id, code, COUNT(*) AS n, MAX(time) AS last FROM ${TABLE}
          WHERE time >= ? GROUP BY tenant_id, code`,
        [new Date(Date.now() - RETENTION_DAYS * 864e5)],
      );
      const byTenant = new Map<string | null, ErrorSummary>();
      for (const r of sum) {
        const prev = byTenant.get(r.tenant_id);
        byTenant.set(r.tenant_id, {
          tenantId: r.tenant_id,
          total: (prev?.total ?? 0) + Number(r.n),
          byCode: { ...prev?.byCode, [r.code]: Number(r.n) },
          lastErrorAt: !prev?.lastErrorAt || r.last > prev.lastErrorAt ? r.last : prev.lastErrorAt,
        });
      }
      this.cachedSummary = [...byTenant.values()].sort((a, b) => b.total - a.total);

      if (Date.now() - this.lastCleanup > CLEANUP_EVERY_MS) {
        this.lastCleanup = Date.now();
        await this.pool.query(`DELETE FROM ${TABLE} WHERE time < ? LIMIT 10000`, [new Date(Date.now() - RETENTION_DAYS * 864e5)]);
      }
    } catch (e) {
      console.error("[errores] no se pudo leer el registro de errores:", (e as Error).message);
    }
  }
}

function safeJson(v: string | null): Record<string, unknown> {
  try {
    return v ? JSON.parse(v) : {};
  } catch {
    return {};
  }
}
