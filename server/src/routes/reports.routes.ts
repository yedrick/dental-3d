import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { db } from "../db.js";
import { cache, CacheKeys, CacheTtl, reportsVersion } from "../lib/cache.js";
import { dayRange } from "../lib/query.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Dashboard y reportes: todo se suma en MySQL (el frontend actual traía todas las filas).
export const dashboardRouter = Router();
export const reportsRouter = Router();
dashboardRouter.use(requireAuth, requirePermission("view.dashboard"));
reportsRouter.use(requireAuth, requirePermission("view.reports"));

const num = (v: unknown) => Number(v ?? 0);
const TOTAL = "(ps.price + ps.invoice_surcharge - ps.discount)";

/** Minutos de diferencia de la hora del negocio (-04:00 → -240), para agrupar por día local. */
const offsetMinutes = (() => {
  const [, sign, h, m] = /^([+-])(\d{2}):(\d{2})$/.exec(config.businessUtcOffset)!;
  return (sign === "-" ? -1 : 1) * (Number(h) * 60 + Number(m));
})();
const LOCAL_DAY = (col: string) => `DATE(DATE_ADD(${col}, INTERVAL ${offsetMinutes} MINUTE))`;

function todayLocal() {
  return new Date(Date.now() + offsetMinutes * 60_000).toISOString().slice(0, 10);
}

// ---------- Dashboard (hoy, hora local). Sin caché: cambia todo el día y es barato. ----------

dashboardRouter.get("/", async (_req, res) => {
  const today = todayLocal();
  const [start, end] = dayRange(today, today);
  const q = db();
  const [[counts], [att], [com], [dep], [cash]] = await Promise.all([
    q.query("SELECT (SELECT COUNT(*) FROM patients) AS patients, (SELECT COUNT(*) FROM doctors) AS doctors"),
    q.query(`SELECT COUNT(*) AS n, SUM(${TOTAL}) AS total, SUM(ps.amount_paid) AS paid FROM patient_studies ps WHERE ps.created_at >= ? AND ps.created_at < ?`, [start, end]),
    q.query("SELECT SUM(commission_amount) AS total FROM commissions WHERE created_at >= ? AND created_at < ?", [start, end]),
    q.query("SELECT SUM(amount) AS total FROM bank_deposits WHERE deposit_date = ?", [today]),
    q.query("SELECT balance FROM cashbox_state WHERE id = 1"),
  ]);
  res.json({
    date: today,
    patients: num(counts.patients),
    doctors: num(counts.doctors),
    attentions_today: num(att.n),
    // total facturado (precio + recargo − descuento); el frontend actual sumaba solo el precio
    income_today: num(att.total),
    collected_today: num(att.paid),
    commissions_today: num(com.total),
    deposits_today: num(dep.total),
    cashbox_balance: num(cash?.balance),
  });
});

// ---------- Reporte del período ----------

const periodSchema = z
  .object({ from: z.iso.date("Fecha inválida (YYYY-MM-DD)"), to: z.iso.date("Fecha inválida (YYYY-MM-DD)") })
  .refine((v) => v.from <= v.to, { message: "La fecha inicial debe ser anterior a la final", path: ["from"] });

async function buildSummary(from: string, to: string) {
  const [start, end] = dayRange(from, to);
  const range = [start, end];
  const q = db();
  const [
    [ps], byDay, byStudy, byMethod, byDoctor, [com], [cash], [tpp], [dep], [newPatients],
    [noDoctor], [noUser], [cashNoUser], [deliveredBefore], [paymentBeforeService], [futureDeposits], [futurePayments],
    [zeroPrices], [noPrice], [overpaid],
  ] = await Promise.all([
    q.query(`SELECT COUNT(*) AS n, SUM(${TOTAL}) AS total, SUM(ps.amount_paid) AS paid,
                    SUM(ps.delivered_at IS NOT NULL) AS delivered
               FROM patient_studies ps WHERE ps.created_at >= ? AND ps.created_at < ?`, range),
    q.query(`SELECT ${LOCAL_DAY("ps.created_at")} AS day, COUNT(*) AS count, SUM(${TOTAL}) AS income
               FROM patient_studies ps WHERE ps.created_at >= ? AND ps.created_at < ?
              GROUP BY day ORDER BY day DESC`, range),
    q.query(`SELECT s.name AS study, COUNT(*) AS count, SUM(${TOTAL}) AS income
               FROM patient_studies ps JOIN studies s ON s.id = ps.study_id
              WHERE ps.created_at >= ? AND ps.created_at < ?
              GROUP BY s.id, s.name ORDER BY count DESC`, range),
    q.query(`SELECT COALESCE(ps.payment_method, 'sin pago') AS method, SUM(ps.amount_paid) AS amount
               FROM patient_studies ps WHERE ps.created_at >= ? AND ps.created_at < ?
              GROUP BY method ORDER BY amount DESC`, range),
    q.query(`SELECT d.full_name AS doctor, COUNT(*) AS count, SUM(c.commission_amount) AS total
               FROM commissions c JOIN doctors d ON d.id = c.doctor_id
              WHERE c.created_at >= ? AND c.created_at < ?
              GROUP BY d.id, d.full_name ORDER BY total DESC`, range),
    q.query("SELECT SUM(commission_amount) AS total FROM commissions WHERE created_at >= ? AND created_at < ?", range),
    q.query("SELECT SUM(income) AS income, SUM(expense) AS expense FROM cashbox WHERE created_at >= ? AND created_at < ?", range),
    q.query("SELECT SUM(amount) AS total FROM third_party_payments WHERE payment_date BETWEEN ? AND ?", [from, to]),
    q.query("SELECT SUM(amount) AS total FROM bank_deposits WHERE deposit_date BETWEEN ? AND ?", [from, to]),
    q.query("SELECT COUNT(*) AS n FROM patients WHERE created_at >= ? AND created_at < ?", range),
    // Controles de calidad (sobre toda la base, como el reporte actual)
    q.query("SELECT COUNT(*) AS n FROM patients WHERE doctor_id IS NULL"),
    q.query("SELECT COUNT(*) AS n FROM patient_studies WHERE created_by IS NULL"),
    q.query("SELECT COUNT(*) AS n FROM cashbox WHERE created_by IS NULL"),
    q.query("SELECT COUNT(*) AS n FROM patient_studies WHERE delivered_at IS NOT NULL AND delivered_at < created_at"),
    q.query("SELECT COUNT(*) AS n FROM third_party_payments WHERE payment_date < service_date"),
    q.query("SELECT COUNT(*) AS n FROM bank_deposits WHERE deposit_date > ?", [todayLocal()]),
    q.query("SELECT COUNT(*) AS n FROM third_party_payments WHERE payment_date > ? OR service_date > ?", [todayLocal(), todayLocal()]),
    q.query("SELECT COUNT(*) AS n FROM study_prices WHERE is_active = 1 AND (price_with_report <= 0 OR price_without_report <= 0)"),
    q.query(`SELECT COUNT(*) AS n FROM studies s WHERE s.active = 1
               AND NOT EXISTS (SELECT 1 FROM study_prices sp WHERE sp.study_id = s.id AND sp.is_active = 1)`),
    q.query(`SELECT COUNT(*) AS n FROM patient_studies ps WHERE ps.amount_paid > ${TOTAL}`),
  ]);

  const total = num(ps.total);
  const paid = num(ps.paid);
  const commissions = num(com.total);
  const thirdParty = num(tpp.total);
  const money = (rows: Record<string, unknown>[], keys: string[]) =>
    rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, num(r[k])])) }));

  return {
    period: { from, to },
    operational: {
      attentions: num(ps.n),
      delivered: num(ps.delivered),
      pending_delivery: num(ps.n) - num(ps.delivered),
      new_patients: num(newPatients.n),
      by_day: money(byDay, ["count", "income"]),
      by_study: money(byStudy, ["count", "income"]),
    },
    financial: {
      billed: total,
      collected: paid,
      debt: Math.max(0, Number((total - paid).toFixed(2))),
      commissions,
      commissions_by_doctor: money(byDoctor, ["count", "total"]),
      cash_in: num(cash.income),
      cash_out: num(cash.expense),
      third_party: thirdParty,
      deposits: num(dep.total),
      // mismo cálculo que el reporte actual: facturado − comisiones − pagos a terceros
      net: Number((total - commissions - thirdParty).toFixed(2)),
      by_method: money(byMethod, ["amount"]),
    },
    control: {
      patients_without_doctor: num(noDoctor.n),
      attentions_without_user: num(noUser.n),
      cashbox_without_user: num(cashNoUser.n),
      date_errors: {
        delivered_before_created: num(deliveredBefore.n),
        payment_before_service: num(paymentBeforeService.n),
        future_deposits: num(futureDeposits.n),
        future_third_party: num(futurePayments.n),
      },
      price_errors: {
        active_price_zero: num(zeroPrices.n),
        active_study_without_price: num(noPrice.n),
      },
      overpaid_attentions: num(overpaid.n),
    },
  };
}

/** Resumen operativo, financiero y de control. Cacheado 1 h por versión de datos. */
reportsRouter.get("/summary", async (req, res) => {
  const { from, to } = periodSchema.parse(req.query);
  const version = await reportsVersion();
  let hit = true;
  const summary = await cache().remember(CacheKeys.report(version, "summary", from, to), CacheTtl.report, () => {
    hit = false;
    return buildSummary(from, to);
  });
  res.setHeader("X-Cache", hit ? "HIT" : "MISS");
  res.json(summary);
});
