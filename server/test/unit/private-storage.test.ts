import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../src/lib/http-error.js";
import { isReceiptKey, signedReceiptUrl, verifySignedReceipt } from "../../src/lib/private-storage.js";

// Solo lo que no toca disco: llaves y enlaces firmados.
const KEY = "receipts/2026/10/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e.jpg";

const query = (url: string) => Object.fromEntries(new URL(url, "http://x").searchParams);

describe("isReceiptKey", () => {
  it("acepta receipts/AAAA/MM/<uuid>.<ext>", () => {
    for (const ext of ["png", "jpg", "webp", "pdf"]) expect(isReceiptKey(KEY.replace(".jpg", `.${ext}`))).toBe(true);
  });

  it("rechaza rutas manipuladas u otros tipos", () => {
    for (const k of [
      "../receipts/2026/10/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e.jpg",
      "receipts/2026/10/../../otra/3f2b8c1e-4d5a-4b6c-9d7e.jpg",
      "receipts/2026/10/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e.svg",
      "receipts/2026/10/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e.jpg.html",
      "otra-sucursal/receipts/2026/10/3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e.jpg",
      "",
    ]) {
      expect(isReceiptKey(k), k).toBe(false);
    }
    expect(isReceiptKey(null)).toBe(false);
    expect(isReceiptKey(123)).toBe(false);
  });
});

describe("enlaces firmados", () => {
  afterEach(() => vi.useRealTimers());

  it("el enlace recién firmado se verifica", () => {
    const { url } = signedReceiptUrl("central", KEY);
    const q = query(url);
    expect(q.key).toBe(KEY);
    expect(verifySignedReceipt("central", q.key, q.exp, q.sig)).toBe(KEY);
  });

  it("no sirve para otra sucursal", () => {
    const q = query(signedReceiptUrl("central", KEY).url);
    expect(() => verifySignedReceipt("sur", q.key, q.exp, q.sig)).toThrow(HttpError);
  });

  it("no sirve para otro archivo ni con la expiración cambiada", () => {
    const q = query(signedReceiptUrl("central", KEY).url);
    expect(() => verifySignedReceipt("central", KEY.replace(".jpg", ".png"), q.exp, q.sig)).toThrow("Enlace inválido");
    expect(() => verifySignedReceipt("central", q.key, String(Number(q.exp) + 3600), q.sig)).toThrow("Enlace inválido");
    // Se cambia un carácter del medio: el último de base64url solo lleva 4 bits útiles (algunos
    // cambios decodifican a la misma firma) y además podía ya ser "A" (la prueba fallaba 1 de cada ~5)
    const i = Math.floor(q.sig.length / 2);
    const tampered = q.sig.slice(0, i) + (q.sig[i] === "A" ? "B" : "A") + q.sig.slice(i + 1);
    expect(() => verifySignedReceipt("central", q.key, q.exp, tampered)).toThrow();
  });

  it("caduca a los 5 minutos", () => {
    vi.useFakeTimers({ now: new Date("2026-10-08T12:00:00Z") });
    const q = query(signedReceiptUrl("central", KEY).url);
    vi.setSystemTime(new Date("2026-10-08T12:04:59Z"));
    expect(verifySignedReceipt("central", q.key, q.exp, q.sig)).toBe(KEY);
    vi.setSystemTime(new Date("2026-10-08T12:05:01Z"));
    try {
      verifySignedReceipt("central", q.key, q.exp, q.sig);
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ status: 403, code: "LINK_EXPIRED" });
    }
  });

  it("parámetros faltantes o de otro tipo → 400", () => {
    for (const [key, exp, sig] of [
      [undefined, "1", "x"],
      [KEY, undefined, "x"],
      [KEY, "1", undefined],
      ["../etc/passwd", "1", "x"],
    ]) {
      expect(() => verifySignedReceipt("central", key, exp, sig)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it("expiración que no es entero → 403", () => {
    expect(() => verifySignedReceipt("central", KEY, "abc", "x")).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe("HttpError", () => {
  it("código según el estado", () => {
    expect(new HttpError(404, "No encontrado").code).toBe("NOT_FOUND");
    expect(new HttpError(429, "Espera").code).toBe("RATE_LIMITED");
    expect(new HttpError(418, "Raro").code).toBe("INTERNAL_ERROR");
    expect(new HttpError(403, "Expiró", "LINK_EXPIRED")).toMatchObject({ status: 403, code: "LINK_EXPIRED", message: "Expiró" });
  });
});
