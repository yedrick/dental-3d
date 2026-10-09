import type { Db } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { fromCents, percentOf, toCents } from "../lib/money.js";

// Reemplaza los triggers de Supabase set_patient_study_price y calc_commission.
// Todo corre dentro de la transacción del registro: el precio sale SIEMPRE de la tarifa
// activa leída en ese momento (nunca del cliente ni de la caché).

export type PaymentMethod = "cash" | "qr" | "card";

export interface AttentionItemInput {
  study_id: string;
  has_report: boolean;
  is_voucher: boolean;
}

export interface CreateAttentionInput {
  patient_id: string;
  doctor_id: string | null;
  clinic_name: string | null;
  with_invoice: boolean;
  invoice_number: string | null;
  payment_method: PaymentMethod | null;
  /** Monto pagado ahora por toda la atención; se reparte entre los estudios en orden. */
  amount_paid: number;
  delivery_date: string | null;
  items: AttentionItemInput[];
}

interface Params {
  invoiceSurchargePct: number;
  firstPatientPct: number;
  voucherAmount: number;
}

interface CommissionDoctor {
  id: string;
  use_percentage: boolean;
  default_commission_pct: number;
  agreement_discount_pct: number;
}

async function loadParams(tx: Db): Promise<Params> {
  const rows = await tx.query<{ key: string; value_num: number | null }[]>(
    "SELECT `key`, value_num FROM app_params WHERE `key` IN ('invoice_surcharge_pct','first_patient_commission_pct','voucher_amount')",
  );
  const get = (k: string, fallback: number) => {
    const v = rows.find((r) => r.key === k)?.value_num;
    return v == null ? fallback : Number(v);
  };
  // Mismos valores por defecto que los triggers (COALESCE(value_num, ...))
  return {
    invoiceSurchargePct: get("invoice_surcharge_pct", 0),
    firstPatientPct: get("first_patient_commission_pct", 50),
    voucherAmount: get("voucher_amount", 50),
  };
}

/**
 * Comisión del doctor por un estudio (antes trigger calc_commission). Reglas actuales:
 * - Vale: monto fijo del parámetro voucher_amount (50 Bs), porcentaje 0.
 * - Doctor con porcentaje: precio × su %, o el % de primer paciente (50) si es su primera atención.
 * - Doctor sin porcentaje: comisión fija del estudio.
 * DECISIÓN PENDIENTE (PLAN.md): hoy el 50% del primer paciente solo aplica a doctores con porcentaje.
 */
export function commissionFor(
  doctor: CommissionDoctor,
  item: { is_voucher: boolean; priceCents: number; fixedCommission: number },
  isFirst: boolean,
  params: Params,
): { amountCents: number; percentage: number } {
  if (item.is_voucher) return { amountCents: toCents(params.voucherAmount), percentage: 0 };
  if (doctor.use_percentage) {
    const pct = isFirst ? params.firstPatientPct : Number(doctor.default_commission_pct ?? 0);
    return { amountCents: percentOf(item.priceCents, pct), percentage: pct };
  }
  return { amountCents: toCents(item.fixedCommission), percentage: 0 };
}

export async function createAttention(tx: Db, input: CreateAttentionInput, userId: string) {
  const [patient] = await tx.query<{ id: string; doctor_id: string; full_name: string }[]>(
    "SELECT id, doctor_id, full_name FROM patients WHERE id = ?",
    [input.patient_id],
  );
  if (!patient) throw new HttpError(404, "Paciente no encontrado");

  const doctorId = input.doctor_id ?? patient.doctor_id;
  // FOR UPDATE: serializa las atenciones del mismo doctor, así dos registros simultáneos
  // no pueden ser ambos "primer paciente" (el trigger de Supabase no lo evitaba).
  const [doctor] = await tx.query<CommissionDoctor[]>(
    "SELECT id, use_percentage, default_commission_pct, agreement_discount_pct FROM doctors WHERE id = ? FOR UPDATE",
    [doctorId],
  );
  if (!doctor) throw new HttpError(400, "El doctor indicado no existe");

  const params = await loadParams(tx);

  // Precio de cada estudio desde su tarifa activa
  const studyIds = [...new Set(input.items.map((i) => i.study_id))];
  const studyRows = await tx.query<
    { id: string; name: string; active: boolean; fixed_commission: number; price_with_report: number | null; price_without_report: number | null }[]
  >(
    `SELECT s.id, s.name, s.active, s.fixed_commission, sp.price_with_report, sp.price_without_report
       FROM studies s
       LEFT JOIN study_prices sp ON sp.study_id = s.id AND sp.is_active = 1
      WHERE s.id IN (?)
      LOCK IN SHARE MODE`,
    [studyIds],
  );
  const studies = new Map(studyRows.map((s) => [s.id, s]));

  const lines = input.items.map((item) => {
    const study = studies.get(item.study_id);
    if (!study) throw new HttpError(400, "Uno de los estudios no existe");
    if (!study.active) throw new HttpError(400, `El estudio "${study.name}" está desactivado`);

    if (item.is_voucher) {
      return { item, study, priceCents: 0, surchargeCents: 0, discountCents: 0, withInvoice: false };
    }
    const price = item.has_report ? study.price_with_report : study.price_without_report;
    if (price == null) throw new HttpError(400, `No hay tarifa activa para el estudio "${study.name}"`);
    const priceCents = toCents(price);
    return {
      item,
      study,
      priceCents,
      // Recargo por factura y descuento por convenio, ambos sobre el precio base (como el trigger)
      surchargeCents: input.with_invoice ? percentOf(priceCents, params.invoiceSurchargePct) : 0,
      discountCents: percentOf(priceCents, Number(doctor.agreement_discount_pct ?? 0)),
      withInvoice: input.with_invoice,
    };
  });

  const totalCents = lines.reduce((s, l) => s + l.priceCents + l.surchargeCents - l.discountCents, 0);
  const paidCents = toCents(input.amount_paid);
  if (paidCents > totalCents) {
    throw new HttpError(400, `El monto pagado (${fromCents(paidCents)}) supera el total (${fromCents(totalCents)})`);
  }
  const hasCharge = lines.some((l) => !l.item.is_voucher);
  if (hasCharge && !input.payment_method) throw new HttpError(400, "Indica el método de pago");

  let remaining = paidCents;
  const created: { id: string; study_id: string; total: number; paid: number; commission: number; percentage: number }[] = [];

  for (const l of lines) {
    const lineTotal = l.priceCents + l.surchargeCents - l.discountCents;
    const linePaid = Math.min(remaining, lineTotal);
    remaining -= linePaid;

    // ¿Primera atención de un paciente de este doctor? (se evalúa antes de insertar, fila por fila,
    // así en una atención con varios estudios solo el primero cuenta como "primer paciente")
    // Lectura con bloqueo (FOR SHARE): ve lo último confirmado. Una lectura normal usaría la
    // "foto" de REPEATABLE READ tomada al inicio de la transacción y no vería la atención que
    // otra transacción acaba de confirmar mientras esta esperaba el bloqueo del doctor.
    const prior = await tx.query<{ one: number }[]>(
      `SELECT 1 AS one FROM patient_studies ps JOIN patients p ON p.id = ps.patient_id
        WHERE p.doctor_id = ? LIMIT 1 FOR SHARE`,
      [doctor.id],
    );
    const has_any = prior.length > 0;

    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      `INSERT INTO patient_studies
         (id, patient_id, study_id, doctor_id, clinic_name, price, has_report, is_voucher, with_invoice,
          invoice_number, invoice_surcharge, discount, amount_paid, payment_method, delivery_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, patient.id, l.item.study_id, doctor.id, input.clinic_name,
        fromCents(l.priceCents), l.item.has_report, l.item.is_voucher, l.withInvoice,
        input.invoice_number, fromCents(l.surchargeCents), fromCents(l.discountCents), fromCents(linePaid),
        l.item.is_voucher ? null : input.payment_method, input.delivery_date, userId,
      ],
    );

    const commission = commissionFor(
      doctor,
      { is_voucher: l.item.is_voucher, priceCents: l.priceCents, fixedCommission: l.study.fixed_commission },
      !has_any,
      params,
    );
    await tx.query(
      "INSERT INTO commissions (doctor_id, patient_study_id, commission_amount, percentage) VALUES (?, ?, ?, ?)",
      [doctor.id, id, fromCents(commission.amountCents), commission.percentage],
    );

    await audit(tx, userId, "INSERT", "patient_studies", id, {
      patient_id: patient.id, study_id: l.item.study_id, doctor_id: doctor.id,
      price: fromCents(l.priceCents), invoice_surcharge: fromCents(l.surchargeCents),
      discount: fromCents(l.discountCents), amount_paid: fromCents(linePaid),
      commission: fromCents(commission.amountCents), commission_pct: commission.percentage,
    });
    created.push({
      id, study_id: l.item.study_id, total: fromCents(lineTotal), paid: fromCents(linePaid),
      commission: fromCents(commission.amountCents), percentage: commission.percentage,
    });
  }

  const summary = {
    patient_id: patient.id,
    patient_name: patient.full_name,
    doctor_id: doctor.id,
    clinic_name: input.clinic_name,
    items_count: created.length,
    inserted_ids: created.map((c) => c.id),
    total: fromCents(totalCents),
    paid: fromCents(paidCents),
    debt: fromCents(totalCents - paidCents),
    payment_method: input.payment_method,
    with_invoice: input.with_invoice,
  };
  await audit(tx, userId, "ATTENTION_CREATE", "patient_studies", patient.id, summary);
  return { ...summary, items: created };
}

/** Columnas calculadas de una atención (total y saldo), para reutilizar en los SELECT. */
export const ATTENTION_TOTALS_SQL = `
  (ps.price + ps.invoice_surcharge - ps.discount) AS total,
  (ps.price + ps.invoice_surcharge - ps.discount - ps.amount_paid) AS debt`;
