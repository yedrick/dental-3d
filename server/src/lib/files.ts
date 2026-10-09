// Detección del tipo real de un archivo por sus primeros bytes ("magic numbers").
// No se confía en el Content-Type ni en la extensión que manda el cliente.

export interface FileKind {
  ext: string;
  type: string;
}

const KINDS: (FileKind & { magic: (b: Buffer) => boolean })[] = [
  { ext: "png", type: "image/png", magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", type: "image/jpeg", magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", type: "image/webp", magic: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
  { ext: "pdf", type: "application/pdf", magic: (b) => b.toString("ascii", 0, 5) === "%PDF-" },
];

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Tipo real del archivo si está entre los permitidos; SVG nunca se acepta (puede llevar scripts). */
export function detectFileKind(body: Buffer, allowedTypes: string[]): FileKind | null {
  const kind = KINDS.find((k) => allowedTypes.includes(k.type) && k.magic(body));
  return kind ? { ext: kind.ext, type: kind.type } : null;
}
