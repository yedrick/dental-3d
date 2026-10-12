import { describe, expect, it } from "vitest";
import { detectFileKind, IMAGE_TYPES } from "../../src/lib/files.js";

const TODOS = [...IMAGE_TYPES, "application/pdf"];
const bytes = (...b: number[]) => Buffer.from([...b, 0, 0, 0, 0, 0, 0, 0, 0]);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const PDF = Buffer.from("%PDF-1.7\n%âãÏÓ\n");

describe("detectFileKind", () => {
  it("reconoce PNG, JPEG, WEBP y PDF por sus primeros bytes", () => {
    expect(detectFileKind(PNG, TODOS)).toEqual({ ext: "png", type: "image/png" });
    expect(detectFileKind(JPEG, TODOS)).toEqual({ ext: "jpg", type: "image/jpeg" });
    expect(detectFileKind(WEBP, TODOS)).toEqual({ ext: "webp", type: "image/webp" });
    expect(detectFileKind(PDF, TODOS)).toEqual({ ext: "pdf", type: "application/pdf" });
  });

  it("rechaza SVG y HTML aunque digan ser imagen", () => {
    expect(detectFileKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), TODOS)).toBeNull();
    expect(detectFileKind(Buffer.from('<?xml version="1.0"?><svg/>'), TODOS)).toBeNull();
    expect(detectFileKind(Buffer.from("<!DOCTYPE html><html><script>alert(1)</script></html>"), TODOS)).toBeNull();
  });

  it("solo acepta los tipos permitidos", () => {
    expect(detectFileKind(PDF, IMAGE_TYPES)).toBeNull();
    expect(detectFileKind(PNG, ["application/pdf"])).toBeNull();
    expect(detectFileKind(PNG, [])).toBeNull();
  });

  it("archivo vacío, cortado o parecido no pasa", () => {
    expect(detectFileKind(Buffer.alloc(0), TODOS)).toBeNull();
    expect(detectFileKind(Buffer.from([0xff, 0xd8]), TODOS)).toBeNull(); // JPEG incompleto
    expect(detectFileKind(PNG.subarray(0, 7), TODOS)).toBeNull();
    const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0x24, 0, 0, 0]), Buffer.from("WAVEfmt ")]);
    expect(detectFileKind(wav, TODOS)).toBeNull();
    expect(detectFileKind(Buffer.from(" %PDF-1.7"), TODOS)).toBeNull(); // la firma debe ir al inicio
  });

  it("SVG no está entre los tipos de imagen", () => {
    expect(IMAGE_TYPES).not.toContain("image/svg+xml");
  });
});
