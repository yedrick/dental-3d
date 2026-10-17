import { describe, expect, it } from "vitest";
import { fromCents, percentOf, toCents } from "../../src/lib/money.js";

describe("toCents / fromCents", () => {
  it("convierte Bs a centavos enteros", () => {
    expect(toCents(0)).toBe(0);
    expect(toCents(309.5)).toBe(30950);
    expect(toCents(0.01)).toBe(1);
    expect(toCents(0.07)).toBe(7); // 0.07 * 100 = 7.000000000000001
    expect(toCents(0.29)).toBe(29); // 0.29 * 100 = 28.999999999999996
    expect(toCents(1250.5)).toBe(125050);
  });

  it("acepta el texto que devuelve MySQL para DECIMAL", () => {
    expect(toCents("309.50" as unknown as number)).toBe(30950);
    expect(toCents("45.00" as unknown as number)).toBe(4500);
  });

  it("montos grandes (tope del esquema money)", () => {
    expect(toCents(9_999_999_999.99)).toBe(999_999_999_999);
    expect(fromCents(999_999_999_999)).toBe(9_999_999_999.99);
  });

  it("fromCents divide entre 100", () => {
    expect(fromCents(30950)).toBe(309.5);
    expect(fromCents(1)).toBe(0.01);
    expect(fromCents(-4024)).toBe(-40.24);
  });

  it("fromCents(toCents(x)) devuelve x para todo monto de 2 decimales hasta 50.000 Bs", () => {
    for (let c = 0; c <= 5_000_000; c++) {
      const x = c / 100;
      if (toCents(x) !== c || fromCents(toCents(x)) !== x) throw new Error(`Falla con ${x}`);
    }
  });

  it("negativos (devoluciones) también ida y vuelta", () => {
    for (const x of [-0.01, -0.29, -309.5, -1250.55]) expect(fromCents(toCents(x))).toBe(x);
  });
});

describe("percentOf", () => {
  it("13% de 309.50 = 40.235 → 40.24 (medio centavo sube)", () => {
    expect(percentOf(toCents(309.5), 13)).toBe(4024);
  });

  it("10% de 0.05 = 0.005 → 0.01", () => {
    expect(percentOf(toCents(0.05), 10)).toBe(1);
  });

  it("medio centavo negativo se aleja del cero", () => {
    expect(percentOf(-5, 10)).toBe(-1);
    expect(percentOf(toCents(-309.5), 13)).toBe(-4024);
  });

  it("menos de medio centavo baja", () => {
    expect(percentOf(4, 10)).toBe(0); // 0.4 centavos
    expect(percentOf(14, 10)).toBe(1); // 1.4 centavos
  });

  it("porcentajes con decimales", () => {
    expect(percentOf(100, 12.5)).toBe(13); // 12.5 centavos
    expect(percentOf(10, 7.5)).toBe(1); // 0.75 centavos
    expect(percentOf(15, 10)).toBe(2); // 15 * 10 / 100 = 1.5
  });

  it("casos exactos", () => {
    expect(percentOf(20000, 15)).toBe(3000);
    expect(percentOf(20000, 50)).toBe(10000);
    expect(percentOf(20000, 100)).toBe(20000);
    expect(percentOf(20000, 0)).toBe(0);
    expect(percentOf(0, 13)).toBe(0);
  });

  it("montos grandes", () => {
    expect(percentOf(999_999_999_999, 13)).toBe(130_000_000_000); // 129.999.999.999,87 → redondea
    expect(percentOf(100_000_000_005, 10)).toBe(10_000_000_001); // ...0,5 sube
  });

  it("siempre devuelve un entero", () => {
    for (let c = 0; c < 2000; c += 7) {
      for (const pct of [1, 3, 7.5, 13, 33.33, 50]) expect(Number.isInteger(percentOf(c, pct))).toBe(true);
    }
  });
});
