import { describe, expect, it } from "vitest";
import { commissionFor, externalCommissionFor, type ExternalDoctorInput } from "../../src/services/attentions.js";

// Solo las funciones puras: createAttention necesita la base y no se prueba aquí.
type Params = Parameters<typeof commissionFor>[3];
type Doctor = Parameters<typeof commissionFor>[0];

const params: Params = { invoiceSurchargePct: 13, firstPatientPct: 50, voucherAmount: 50 };

const conPorcentaje: Doctor = { id: "d1", use_percentage: true, default_commission_pct: 13, agreement_discount_pct: 0 };
const sinPorcentaje: Doctor = { id: "d2", use_percentage: false, default_commission_pct: 13, agreement_discount_pct: 0 };

const estudio = (priceCents: number, fixedCommission = 45, is_voucher = false) => ({ priceCents, fixedCommission, is_voucher });

describe("commissionFor (doctor registrado)", () => {
  it("vale: monto del parámetro voucher_amount y 0%", () => {
    expect(commissionFor(conPorcentaje, estudio(0, 45, true), false, params)).toEqual({ amountCents: 5000, percentage: 0 });
    expect(commissionFor(sinPorcentaje, estudio(0, 45, true), false, params)).toEqual({ amountCents: 5000, percentage: 0 });
  });

  it("vale gana incluso si es el primer paciente", () => {
    expect(commissionFor(conPorcentaje, estudio(20000, 45, true), true, params)).toEqual({ amountCents: 5000, percentage: 0 });
  });

  it("vale con otro monto configurado", () => {
    expect(commissionFor(conPorcentaje, estudio(0, 0, true), false, { ...params, voucherAmount: 37.5 })).toEqual({
      amountCents: 3750,
      percentage: 0,
    });
  });

  it("con porcentaje y primer paciente: usa firstPatientPct", () => {
    expect(commissionFor(conPorcentaje, estudio(20000), true, params)).toEqual({ amountCents: 10000, percentage: 50 });
  });

  it("con porcentaje, no primero: usa default_commission_pct (13% de 309.50 = 40.24)", () => {
    expect(commissionFor(conPorcentaje, estudio(30950), false, params)).toEqual({ amountCents: 4024, percentage: 13 });
  });

  it("porcentaje que llega como texto DECIMAL de MySQL", () => {
    const doc = { ...conPorcentaje, default_commission_pct: "12.50" as unknown as number };
    expect(commissionFor(doc, estudio(10000), false, params)).toEqual({ amountCents: 1250, percentage: 12.5 });
  });

  it("porcentaje nulo cuenta como 0", () => {
    const doc = { ...conPorcentaje, default_commission_pct: null as unknown as number };
    expect(commissionFor(doc, estudio(10000), false, params)).toEqual({ amountCents: 0, percentage: 0 });
  });

  it("sin porcentaje: comisión fija del estudio", () => {
    expect(commissionFor(sinPorcentaje, estudio(30950, 45), false, params)).toEqual({ amountCents: 4500, percentage: 0 });
    expect(commissionFor(sinPorcentaje, estudio(30950, "45.50" as unknown as number), false, params)).toEqual({
      amountCents: 4550,
      percentage: 0,
    });
  });

  it("sin porcentaje y primer paciente: sigue siendo la fija (decisión pendiente en PLAN.md)", () => {
    expect(commissionFor(sinPorcentaje, estudio(20000, 45), true, params)).toEqual({ amountCents: 4500, percentage: 0 });
  });
});

describe("externalCommissionFor (doctor no registrado)", () => {
  const pct = (v: number): ExternalDoctorInput => ({ name: "Dr. Externo", commission_type: "pct", commission_value: v });
  const fija = (v: number): ExternalDoctorInput => ({ name: "Dr. Externo", commission_type: "fixed", commission_value: v });

  it("porcentaje: 15% de 200 = 30", () => {
    expect(externalCommissionFor(pct(15), { is_voucher: false, priceCents: 20000 }, params)).toEqual({ amountCents: 3000, percentage: 15 });
  });

  it("porcentaje con medio centavo: 13% de 309.50 = 40.24", () => {
    expect(externalCommissionFor(pct(13), { is_voucher: false, priceCents: 30950 }, params)).toEqual({ amountCents: 4024, percentage: 13 });
  });

  it("fija: 45 por estudio, sin importar el precio", () => {
    expect(externalCommissionFor(fija(45), { is_voucher: false, priceCents: 20000 }, params)).toEqual({ amountCents: 4500, percentage: 0 });
    expect(externalCommissionFor(fija(45), { is_voucher: false, priceCents: 99900 }, params)).toEqual({ amountCents: 4500, percentage: 0 });
  });

  it("vale: como cualquier doctor (voucher_amount, 0%)", () => {
    expect(externalCommissionFor(pct(15), { is_voucher: true, priceCents: 0 }, params)).toEqual({ amountCents: 5000, percentage: 0 });
    expect(externalCommissionFor(fija(45), { is_voucher: true, priceCents: 0 }, params)).toEqual({ amountCents: 5000, percentage: 0 });
  });
});
