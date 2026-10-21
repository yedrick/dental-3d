import { afterEach, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { dateRangeSchema, dayRange, paged, paginate, paginationSchema } from "../../src/lib/query.js";

describe("dayRange (Bolivia, -04:00)", () => {
  const original = config.businessUtcOffset;
  afterEach(() => {
    config.businessUtcOffset = original;
  });

  it("usa -04:00 por defecto", () => {
    expect(config.businessUtcOffset).toBe("-04:00");
  });

  it("un día local = [04:00 de ese día, 04:00 del siguiente) en UTC", () => {
    expect(dayRange("2026-10-08", "2026-10-08")).toEqual(["2026-10-08 04:00:00", "2026-10-09 04:00:00"]);
  });

  it("rango de varios días", () => {
    expect(dayRange("2026-10-01", "2026-10-31")).toEqual(["2026-10-01 04:00:00", "2026-11-01 04:00:00"]);
  });

  it("fin de mes y fin de año", () => {
    expect(dayRange("2026-09-30", "2026-09-30")).toEqual(["2026-09-30 04:00:00", "2026-10-01 04:00:00"]);
    expect(dayRange("2026-12-31", "2026-12-31")).toEqual(["2026-12-31 04:00:00", "2027-01-01 04:00:00"]);
    expect(dayRange("2026-12-15", "2027-01-15")).toEqual(["2026-12-15 04:00:00", "2027-01-16 04:00:00"]);
  });

  it("febrero normal y bisiesto", () => {
    expect(dayRange("2026-02-28", "2026-02-28")[1]).toBe("2026-03-01 04:00:00");
    expect(dayRange("2028-02-28", "2028-02-28")[1]).toBe("2028-02-29 04:00:00");
    expect(dayRange("2028-02-29", "2028-02-29")[1]).toBe("2028-03-01 04:00:00");
  });

  it("formato DATETIME de MySQL (sin T, sin Z, sin milisegundos)", () => {
    for (const v of dayRange("2026-01-01", "2026-01-02")) expect(v).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("respeta otro desfase configurado", () => {
    config.businessUtcOffset = "+05:30";
    expect(dayRange("2026-10-08", "2026-10-08")).toEqual(["2026-10-07 18:30:00", "2026-10-08 18:30:00"]);
    config.businessUtcOffset = "+00:00";
    expect(dayRange("2026-10-08", "2026-10-08")).toEqual(["2026-10-08 00:00:00", "2026-10-09 00:00:00"]);
  });

  it("fecha imposible lanza error (dateRangeSchema la rechaza antes)", () => {
    expect(() => dayRange("2026-13-01", "2026-13-01")).toThrow(RangeError);
  });
});

describe("paginate / paged", () => {
  it("calcula el offset", () => {
    expect(paginate(1, 50)).toEqual({ limit: 50, offset: 0 });
    expect(paginate(2, 50)).toEqual({ limit: 50, offset: 50 });
    expect(paginate(3, 20)).toEqual({ limit: 20, offset: 40 });
  });

  it("cuenta las páginas", () => {
    expect(paged([], 0, 1, 50)).toEqual({ data: [], page: 1, limit: 50, total: 0, pages: 0 });
    expect(paged([1], 100, 1, 50).pages).toBe(2);
    expect(paged([1], 101, 1, 50).pages).toBe(3);
    expect(paged([1], 1, 1, 50).pages).toBe(1);
  });
});

describe("paginationSchema", () => {
  it("valores por defecto: página 1, 50 por página", () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, limit: 50 });
  });

  it("convierte el texto de la query string", () => {
    expect(paginationSchema.parse({ page: "3", limit: "20" })).toEqual({ page: 3, limit: 20 });
  });

  it("rechaza página 0, límite 0, más de 500, decimales y texto", () => {
    for (const q of [{ page: "0" }, { limit: "0" }, { limit: "501" }, { page: "1.5" }, { page: "abc" }, { page: "-1" }]) {
      expect(paginationSchema.safeParse(q).success, JSON.stringify(q)).toBe(false);
    }
    expect(paginationSchema.parse({ limit: "500" }).limit).toBe(500);
  });
});

describe("dateRangeSchema", () => {
  it("acepta rango válido, un solo extremo o ninguno", () => {
    expect(dateRangeSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: "2026-10-08", to: "2026-10-08" }).success).toBe(true);
    expect(dateRangeSchema.safeParse({ from: "2026-10-01" }).success).toBe(true);
    expect(dateRangeSchema.safeParse({}).success).toBe(true);
  });

  it("rechaza desde > hasta con el mensaje en español", () => {
    const r = dateRangeSchema.safeParse({ from: "2026-10-31", to: "2026-10-01" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ message: "La fecha inicial debe ser anterior a la final", path: ["from"] });
  });

  it("rechaza fechas imposibles o con otro formato", () => {
    for (const from of ["2026-13-01", "2026-02-30", "08/10/2026", "2026-10-08T00:00:00"]) {
      expect(dateRangeSchema.safeParse({ from }).success, from).toBe(false);
    }
  });
});
