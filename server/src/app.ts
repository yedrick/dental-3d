import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { tenancyMiddleware } from "@tenancy-node/adapter-express";
import { config } from "./config.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { requireTenant } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.routes.js";
import { brandingRouter, LOGO_MAX_BYTES } from "./routes/branding.routes.js";
import { doctorsRouter } from "./routes/doctors.routes.js";
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
app.use("/api/branding", brandingRouter);

app.use(notFound);
app.use(errorHandler);
