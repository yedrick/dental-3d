import { config } from "../config.js";
import { tenancy } from "../tenancy/index.js";
import { leadEmail, mailConfigured, sendInBackground, sendMail } from "./mailer.js";

/** Panel /admin del dominio principal: TENANT_PUBLIC_URL sin la parte de la sucursal. */
const panelUrl = () => `${config.admin.tenantUrl.replace("{tenant}.", "")}/admin/leads`;

/**
 * Cada "Solicitar demo" de la web comercial (POST /admin/api/leads) publica `lead.created`:
 * se avisa por correo al de ventas del panel (Plataforma) o, si no hay, a SALES_NOTIFY_TO. La solicitud ya quedó guardada en el panel (Solicitudes),
 * así que si el correo falla no se pierde nada.
 */
export function notifySalesOnLeads() {
  tenancy.events.on("lead.created", async ({ data }) => {
    // Correos de ventas del panel (Plataforma, tenancy-node 0.12); si no hay, SALES_NOTIFY_TO del .env
    const fromPanel = (data as { notifyTo?: string[] }).notifyTo ?? [];
    const to = fromPanel.length ? fromPanel.join(", ") : config.mail.salesTo;
    if (!to || !mailConfigured()) return;
    const lead = data as Parameters<typeof leadEmail>[0];
    const mail = leadEmail(lead, panelUrl());
    sendInBackground(() => sendMail({ to, fromName: "IONIX", ...mail }), { operation: "lead.notify" });
  });
}
