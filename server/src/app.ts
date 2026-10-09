import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { tenancyMiddleware } from "@tenancy-node/adapter-express";
import { config } from "./config.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { requireTenant } from "./middleware/auth.js";
import { appointmentsRouter } from "./routes/appointments.routes.js";
import { attentionsRouter } from "./routes/attentions.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { brandingRouter, LOGO_MAX_BYTES } from "./routes/branding.routes.js";
import { cashboxRouter } from "./routes/cashbox.routes.js";
import { commissionsRouter } from "./routes/commissions.routes.js";
import { doctorsRouter } from "./routes/doctors.routes.js";
import { depositsRouter, thirdPartyRouter } from "./routes/finance.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { patientsRouter } from "./routes/patients.routes.js";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, receiptsRouter } from "./routes/receipts.routes.js";
import { studiesRouter, studyPricesRouter } from "./routes/studies.routes.js";
import { tenancy } from "./tenancy/index.js";

// Mensajes de validación en español
z.config(z.locales.es());

export const app = express();

app.set("trust proxy", config.trustProxy);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // el logo se muestra desde el dominio del frontend
app.use(cors({ origin: config.corsOrigin, exposedHeaders: ["X-Cache", "RateLimit", "RateLimit-Policy"] }));
app.use(compression()); // JSON de listas grandes: 5-10 veces menos bytes

// Los body parsers van ANTES de tenancy: leer el body después pierde el contexto del tenant.
app.use("/api/branding/logo", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: LOGO_MAX_BYTES }));
app.use("/api/receipts", express.raw({ type: RECEIPT_TYPES, limit: RECEIPT_MAX_BYTES }));
app.use(express.json({ limit: "1mb" }));

// Health del balanceador: sin tenant y sin detalles de los servicios internos
app.get("/api/health", async (_req, res) => {
  const report = await tenancy.health();
  const ok = report.status === "ok";
  res.status(ok ? 200 : 503).json({ ok });
});

// Identifica la sucursal por subdominio (sur.localhost → "sur") y abre su contexto:
// base, caché y archivos de esa sucursal. También responde /tenancy/me, theme.css y assets.
app.use(tenancyMiddleware(tenancy, { skip: (req) => req.path === "/api/health" }));

// Datos de pacientes y dinero: el navegador revalida siempre (ETag) y ningún proxy los guarda
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-cache");
  next();
});

app.use("/api", requireTenant);
app.use("/api/auth", authRouter);
app.use("/api/doctors", doctorsRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/studies", studiesRouter);
app.use("/api/study-prices", studyPricesRouter);
app.use("/api/attentions", attentionsRouter);
app.use("/api/commissions", commissionsRouter);
app.use("/api/cashbox", cashboxRouter);
app.use("/api/deposits", depositsRouter);
app.use("/api/third-party-payments", thirdPartyRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/appointments", appointmentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/branding", brandingRouter);

app.use(notFound);
app.use(errorHandler);
