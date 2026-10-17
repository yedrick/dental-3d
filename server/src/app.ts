import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { z } from "zod";
import { requireFeature, tenancyMiddleware } from "@tenancy-node/adapter-express";
import { adminMiddleware, createAdminApi } from "@tenancy-node/admin-api";
import { config } from "./config.js";
import { tenantUsers } from "./tenancy/admin-users.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { requireTenant } from "./middleware/auth.js";
import { bumpReportsVersion } from "./lib/cache.js";
import { appointmentsRouter } from "./routes/appointments.routes.js";
import { attentionsRouter } from "./routes/attentions.routes.js";
import { auditRouter } from "./routes/audit.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { brandingRouter, LOGO_MAX_BYTES } from "./routes/branding.routes.js";
import { cashboxRouter } from "./routes/cashbox.routes.js";
import { commissionsRouter } from "./routes/commissions.routes.js";
import { doctorsRouter } from "./routes/doctors.routes.js";
import { depositsRouter, thirdPartyRouter } from "./routes/finance.routes.js";
import { notificationsRouter } from "./routes/notifications.routes.js";
import { paramsRouter } from "./routes/params.routes.js";
import { dashboardRouter, reportsRouter } from "./routes/reports.routes.js";
import { rolesRouter } from "./routes/roles.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { patientsRouter } from "./routes/patients.routes.js";
import { RECEIPT_MAX_BYTES, RECEIPT_TYPES, receiptsRouter } from "./routes/receipts.routes.js";
import { publicSiteRouter, SITE_IMAGE_MAX_BYTES, siteRouter } from "./routes/site.routes.js";
import { publicStudiesRouter, studiesRouter, studyPricesRouter } from "./routes/studies.routes.js";
import { tenancy } from "./tenancy/index.js";
import { notifySalesOnLeads } from "./lib/leads.js";

// Mensajes de validación en español
z.config(z.locales.es());

export const app = express();

app.set("trust proxy", config.trustProxy);

// Panel de la plataforma de tenancy-node: https://dominio.com/admin (solo responde en los dominios
// centrales; en una sucursal da 404). Crear sucursales (con su base y su ADMIN por defecto), dominios,
// tema, suspender/mantenimiento, auditoría y "Entrar como…". Va antes de los body parsers y de
// helmet: lee su propio body y pone sus propios encabezados de seguridad.
if (config.admin.sessionSecret) {
  const admin = createAdminApi(tenancy, {
    sessionSecret: config.admin.sessionSecret,
    secureCookies: config.admin.secureCookies,
    ui: true,
    // "Entrar como…" abre la sucursal por su subdominio y la app canjea el token
    impersonationUrl: ({ tenantId, token }) =>
      `${config.admin.tenantUrl.replace("{tenant}", tenantId)}/api/auth/impersonate?token=${encodeURIComponent(token)}`,
    // Detrás de nginx: la IP real (límite de intentos de login y auditoría) sale de X-Forwarded-For
    trustProxy: config.trustProxy,
    // Usuarios de cada sucursal en el panel: verlos, crearlos y "Entrar como"
    tenantUsers,
    // "Solicitar demo" de la web comercial: POST /admin/api/leads (5 por hora por IP, con consentimiento).
    // En el panel: Solicitudes → "Crear tenant" con el plan elegido.
    leads: { requireConsent: true },
  });
  app.use(adminMiddleware(admin));
  notifySalesOnLeads();
}
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } })); // el logo se muestra desde el dominio del frontend
app.use(cors({ origin: config.corsOrigin, exposedHeaders: ["X-Cache", "RateLimit", "RateLimit-Policy"] }));
app.use(compression()); // JSON de listas grandes: 5-10 veces menos bytes

// Los body parsers van ANTES de tenancy: leer el body después pierde el contexto del tenant.
app.use("/api/branding/logo", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: LOGO_MAX_BYTES }));
app.use("/api/receipts", express.raw({ type: RECEIPT_TYPES, limit: RECEIPT_MAX_BYTES }));
app.use("/api/site/images", express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: SITE_IMAGE_MAX_BYTES }));
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
app.use("/api", (req, res, next) => {
  if (!req.path.startsWith("/public/")) res.setHeader("Cache-Control", "private, no-cache");
  next();
});

app.use("/api", requireTenant);

// Los cambios de datos que salen en los reportes invalidan los reportes cacheados de la sucursal.
// El login, las notificaciones, la página web o una vista previa del Excel no los borran.
const REPORT_DATA = /^\/(attentions|patients|doctors|studies|study-prices|cashbox|deposits|third-party-payments|params)(\/|$)/;
app.use("/api", (req, res, next) => {
  const tenantId = tenancy.currentId();
  const changesReports =
    REPORT_DATA.test(req.path) && !(req.path === "/studies/import" && req.body?.aplicar !== true);
  if (tenantId && req.method !== "GET" && req.method !== "HEAD" && changesReports) {
    // "finish" puede llegar con el contexto de la sucursal ya cerrado: se vuelve a abrir
    res.on("finish", () => {
      if (res.statusCode < 400) {
        tenancy.run(tenantId, () => bumpReportsVersion()).catch((err) =>
          tenancy.observability.logger.error({ err, tenantId }, "no se pudo invalidar la caché de reportes"));
      }
    });
  }
  next();
});

app.use("/api/auth", authRouter);
app.use("/api/doctors", doctorsRouter);
app.use("/api/patients", patientsRouter);
app.use("/api/public/studies", publicStudiesRouter);
app.use("/api/public/site", publicSiteRouter);
// Módulos por plan (src/tenancy/plans.ts): si el plan no lo incluye, 403 TENANCY_FEATURE_NOT_IN_PLAN.
// Además de estos, cada ruta sigue exigiendo el permiso del rol.
app.use("/api/site", requireFeature(tenancy, "pagina_web"), siteRouter);
app.use("/api/studies", studiesRouter);
app.use("/api/study-prices", studyPricesRouter);
app.use("/api/attentions", attentionsRouter);
app.use("/api/commissions", requireFeature(tenancy, "comisiones"), commissionsRouter);
app.use("/api/cashbox", requireFeature(tenancy, "caja"), cashboxRouter);
app.use("/api/deposits", requireFeature(tenancy, "finanzas"), depositsRouter);
app.use("/api/third-party-payments", requireFeature(tenancy, "finanzas"), thirdPartyRouter);
app.use("/api/receipts", receiptsRouter);
app.use("/api/appointments", requireFeature(tenancy, "agenda"), appointmentsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/users", usersRouter);
app.use("/api/roles", rolesRouter);
app.use("/api/params", paramsRouter);
app.use("/api/audit", requireFeature(tenancy, "auditoria"), auditRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", requireFeature(tenancy, "reportes"), reportsRouter);
app.use("/api/branding", brandingRouter);

app.use(notFound);
app.use(errorHandler);
