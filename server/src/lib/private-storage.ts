import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { LocalStorage } from "@tenancy-node/core";
import { config } from "../config.js";
import { HttpError } from "./http-error.js";
import type { FileKind } from "./files.js";

/**
 * Archivos PRIVADOS por sucursal (comprobantes). Usa el driver de disco de tenancy-node con
 * otra raíz, que NO se sirve en /tenancy/assets: solo se descargan con un enlace firmado
 * de corta duración (como createSignedUrl de Supabase). El driver verifica que la ruta no
 * salga de su carpeta aunque la llave venga manipulada.
 */
const driver = new LocalStorage({ root: config.privateStorageDir });

// receipts/2026/10/<uuid>.jpg
const KEY_RE = /^receipts\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(png|jpg|webp|pdf)$/;

export function isReceiptKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

const physical = (tenantId: string, key: string) => `${tenantId}/${key}`;

export async function putReceipt(tenantId: string, body: Buffer, kind: FileKind) {
  const now = new Date();
  const key = `receipts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${kind.ext}`;
  await driver.put(physical(tenantId, key), body, { contentType: kind.type });
  return key;
}

export async function receiptExists(tenantId: string, key: string) {
  return isReceiptKey(key) && (await driver.exists(physical(tenantId, key)));
}

export async function getReceipt(tenantId: string, key: string) {
  if (!isReceiptKey(key)) return undefined;
  return driver.get(physical(tenantId, key));
}

// ---- Enlaces firmados: válidos solo para esa sucursal, ese archivo y por pocos minutos ----

const sign = (tenantId: string, key: string, exp: number) =>
  createHmac("sha256", `${config.jwt.secret}:receipts`).update(`${tenantId}\n${key}\n${exp}`).digest("base64url");

export function signedReceiptUrl(tenantId: string, key: string, ttlSeconds = 300) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const qs = new URLSearchParams({ key, exp: String(exp), sig: sign(tenantId, key, exp) });
  return { url: `/api/receipts/file?${qs}`, expires_at: new Date(exp * 1000).toISOString() };
}

export function verifySignedReceipt(tenantId: string, key: unknown, exp: unknown, sig: unknown): string {
  if (!isReceiptKey(key) || typeof exp !== "string" || typeof sig !== "string") {
    throw new HttpError(400, "Enlace inválido");
  }
  const expNum = Number(exp);
  if (!Number.isInteger(expNum) || expNum < Date.now() / 1000) throw new HttpError(403, "El enlace expiró", "LINK_EXPIRED");
  const expected = Buffer.from(sign(tenantId, key, expNum));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new HttpError(403, "Enlace inválido");
  return key;
}
