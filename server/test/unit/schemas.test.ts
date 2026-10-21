import { describe, expect, it } from "vitest";
import { money, optionalEmail, optionalText, username, uuid } from "../../src/lib/schemas.js";

const mensajes = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues.map((i) => i.message) ?? [];

describe("money", () => {
  it("acepta 0, 0.01, 1250.5 y montos de 2 decimales con error de coma flotante", () => {
    for (const v of [0, 0.01, 1250.5, 0.07, 0.29, 1.1, 309.5, 9_999_999_999.99]) {
      expect(money.safeParse(v).success, String(v)).toBe(true);
    }
  });

  it("rechaza negativos", () => {
    expect(mensajes(money.safeParse(-1))).toContain("No puede ser negativo");
    expect(mensajes(money.safeParse(-0.01))).toContain("No puede ser negativo");
  });

  it("rechaza más de 2 decimales", () => {
    expect(mensajes(money.safeParse(1.234))).toContain("Máximo 2 decimales");
    expect(mensajes(money.safeParse(0.001))).toContain("Máximo 2 decimales");
    expect(mensajes(money.safeParse(2.675))).toContain("Máximo 2 decimales");
  });

  it("rechaza lo que no es número", () => {
    for (const v of ["10", null, undefined, NaN, Infinity, {}]) {
      expect(mensajes(money.safeParse(v)), String(v)).toContain("Debe ser un número");
    }
  });

  it("rechaza más del tope", () => {
    expect(money.safeParse(10_000_000_000).success).toBe(false);
  });

  // Antes fallaba: v * 100 tiene error de coma flotante por encima de ~134 millones (corregido en schemas.ts)
  it("acepta montos grandes de 2 decimales bajo el tope", () => {
    expect(money.safeParse(1_234_567_890.12).success).toBe(true);
    expect(money.safeParse(134_234_855.52).success).toBe(true);
  });
});

describe("username", () => {
  it("rechaza @", () => {
    expect(mensajes(username.safeParse("juan@clinica.com"))).toContain("El nombre de usuario no puede tener @ (para eso está el email)");
  });

  it("recorta espacios", () => {
    expect(username.parse("  juan.perez  ")).toBe("juan.perez");
  });

  it("vacío o solo espacios: Usuario requerido", () => {
    expect(mensajes(username.safeParse(""))).toContain("Usuario requerido");
    expect(mensajes(username.safeParse("   "))).toContain("Usuario requerido");
  });

  it("máximo 100 caracteres", () => {
    expect(username.safeParse("a".repeat(100)).success).toBe(true);
    expect(username.safeParse("a".repeat(101)).success).toBe(false);
  });
});

describe("optionalText", () => {
  const t = optionalText();

  it('"", espacios, null y undefined se guardan como null', () => {
    for (const v of ["", "   ", null, undefined]) expect(t.parse(v)).toBeNull();
  });

  it("recorta el texto", () => {
    expect(t.parse("  hola  ")).toBe("hola");
  });

  it("respeta el máximo (después de recortar)", () => {
    expect(optionalText(5).safeParse("123456").success).toBe(false);
    expect(optionalText(5).parse("  12345  ")).toBe("12345");
    expect(t.safeParse("x".repeat(501)).success).toBe(false);
  });
});

describe("optionalEmail", () => {
  it('"", null y undefined → null', () => {
    for (const v of ["", null, undefined]) expect(optionalEmail.parse(v)).toBeNull();
  });

  it("deja pasar un email válido", () => {
    expect(optionalEmail.parse("paciente@correo.com")).toBe("paciente@correo.com");
  });

  it("rechaza email inválido", () => {
    expect(mensajes(optionalEmail.safeParse("no-es-email"))).toContain("Email inválido");
  });
});

describe("uuid", () => {
  it("acepta UUID y rechaza lo demás", () => {
    expect(uuid.safeParse("3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e").success).toBe(true);
    expect(mensajes(uuid.safeParse("123"))).toContain("Identificador inválido");
  });
});
