import { Router } from "express";
import { z } from "zod";
import { detectFileKind, IMAGE_TYPES } from "../lib/files.js";
import { HttpError } from "../lib/http-error.js";
import { getReceipt, isReceiptKey, putReceipt, signedReceiptUrl, verifySignedReceipt } from "../lib/private-storage.js";
import { denyDoctorScope, requireAuth, requirePermission } from "../middleware/auth.js";
import { tenancy } from "../tenancy/index.js";

/**
 * Comprobantes (depósitos y pagos a terceros), en almacenamiento privado por sucursal.
 * 1. POST /api/receipts (binario) → { key }
 * 2. Se envía esa key como receipt_key al crear el depósito o el pago.
 * 3. Para verlo: GET /api/receipts/url?key=... → enlace firmado válido 5 minutos.
 */
export const receiptsRouter = Router();
export const RECEIPT_MAX_BYTES = 5 * 1024 * 1024;
export const RECEIPT_TYPES = [...IMAGE_TYPES, "application/pdf"];

const tenantId = () => tenancy.currentId()!;

// Descarga con enlace firmado: no lleva token (sirve para <img src> y para abrir el PDF).
// La firma incluye la sucursal, el archivo y la expiración.
receiptsRouter.get("/file", async (req, res) => {
  const key = verifySignedReceipt(tenantId(), req.query.key, req.query.exp, req.query.sig);
  const body = await getReceipt(tenantId(), key);
  if (!body) throw new HttpError(404, "Comprobante no encontrado");
  const kind = detectFileKind(Buffer.from(body), RECEIPT_TYPES);
  res.setHeader("Content-Type", kind?.type ?? "application/octet-stream");
  res.setHeader("Cache-Control", "private, max-age=300");
  res.setHeader("Content-Security-Policy", "sandbox"); // un PDF no puede ejecutar nada en nuestro dominio
  res.setHeader("Content-Disposition", "inline");
  res.end(Buffer.from(body));
});

receiptsRouter.use(requireAuth);

// Ver comprobantes: quien ve caja, depósitos o pagos a terceros (según la matriz de Roles)
receiptsRouter.get("/url", requirePermission("view.cashbox", "view.deposits", "view.third_party"), denyDoctorScope, async (req, res) => {
  const { key } = z.object({ key: z.string() }).parse(req.query);
  if (!isReceiptKey(key)) throw new HttpError(400, "Comprobante inválido");
  res.json(signedReceiptUrl(tenantId(), key));
});

// Subir: quien puede registrar depósitos o pagos a terceros
receiptsRouter.post("/", requirePermission("deposits.create", "third_party.create"), async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new HttpError(415, "Envía el archivo como cuerpo binario (imagen PNG, JPG, WEBP o PDF)");
  }
  const kind = detectFileKind(body, RECEIPT_TYPES);
  if (!kind) throw new HttpError(415, "El archivo no es una imagen PNG, JPG, WEBP ni un PDF válido");
  const key = await putReceipt(tenantId(), body, kind);
  res.status(201).json({ key, type: kind.type, bytes: body.length });
});
