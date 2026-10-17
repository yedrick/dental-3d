import nodemailer, { type Transporter } from "nodemailer";
import { config } from "../config.js";
import { tenancy } from "../tenancy/index.js";

/**
 * Envío de correos por SMTP (Brevo, Zoho, Google, Amazon SES, Mailpit en local…).
 * Se configura en .env con MAIL_SMTP_HOST, MAIL_SMTP_PORT, MAIL_SMTP_SECURE, MAIL_SMTP_USER,
 * MAIL_SMTP_PASS y MAIL_FROM. Sin MAIL_SMTP_HOST no se envía nada.
 */
let transporter: Transporter | null = null;

export const mailConfigured = () => Boolean(config.mail.host);

function transport(): Transporter {
  transporter ??= nodemailer.createTransport({
    host: config.mail.host,
    port: config.mail.port,
    secure: config.mail.secure,
    ...(config.mail.user ? { auth: { user: config.mail.user, pass: config.mail.pass } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return transporter;
}

/** Remitente con el nombre de la sucursal: "3D Dental Calacoto <no-responder@dominio.com>". */
function fromWithName(name: string) {
  const address = /<([^>]+)>/.exec(config.mail.from)?.[1] ?? config.mail.from;
  const clean = name.replace(/["\r\n<>]/g, "").trim();
  return clean ? `"${clean}" <${address}>` : address;
}

export async function sendMail(opts: { to: string; subject: string; text: string; html: string; fromName?: string }) {
  if (!mailConfigured()) throw new Error("Correo no configurado (MAIL_SMTP_HOST)");
  await transport().sendMail({
    from: fromWithName(opts.fromName ?? ""),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Correo con el código para recuperar la contraseña, con el nombre y el logo de la sucursal. */
export function passwordResetEmail(opts: { branchName: string; userName: string; code: string; minutes: number; resetUrl: string; logoUrl?: string }) {
  const { branchName, userName, code, minutes, resetUrl, logoUrl } = opts;
  const subject = `${code} es tu código para recuperar la contraseña · ${branchName}`;
  const text = [
    `Hola ${userName}:`,
    "",
    `Tu código para recuperar la contraseña en ${branchName} es: ${code}`,
    `Vence en ${minutes} minutos y sirve una sola vez.`,
    "",
    `Escríbelo en: ${resetUrl}`,
    "",
    "Si no lo pediste, ignora este correo: tu contraseña no cambia.",
  ].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;padding:28px">
      <tr><td align="center" style="padding-bottom:16px">
        ${logoUrl ? `<img src="${esc(logoUrl)}" alt="" width="56" height="56" style="border-radius:10px;display:block;margin-bottom:8px">` : ""}
        <div style="font-size:16px;font-weight:bold">${esc(branchName)}</div>
      </td></tr>
      <tr><td style="font-size:14px;line-height:1.5">
        <p style="margin:0 0 12px">Hola ${esc(userName)}:</p>
        <p style="margin:0 0 16px">Tu código para recuperar la contraseña es:</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;text-align:center;background:#f1f5f9;border-radius:8px;padding:14px 0;font-family:'Courier New',monospace">${esc(code)}</div>
        <p style="margin:16px 0 0;color:#475569">Vence en ${minutes} minutos y sirve una sola vez.</p>
        <p style="margin:16px 0 0"><a href="${esc(resetUrl)}" style="color:#0e7490">Escribir el código</a></p>
        <p style="margin:20px 0 0;color:#64748b;font-size:12px">Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Aviso a ventas: nueva solicitud de demo desde la web comercial (panel → Solicitudes). */
export function leadEmail(lead: { name: string; company?: string | null; city?: string | null; phone?: string | null; email?: string | null; plan?: string | null; message?: string | null }, panelUrl: string) {
  const who = lead.company ? `${lead.name} (${lead.company})` : lead.name;
  const rows: [string, string | null | undefined][] = [
    ["Nombre", lead.name], ["Clínica", lead.company], ["Ciudad", lead.city], ["WhatsApp / teléfono", lead.phone],
    ["Correo", lead.email], ["Plan de interés", lead.plan], ["Mensaje", lead.message],
  ];
  const filled = rows.filter(([, v]) => v);
  const subject = `Nueva solicitud de demo: ${who}`;
  const text = [...filled.map(([k, v]) => `${k}: ${v}`), "", `Verla en el panel: ${panelUrl}`].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
      <tr><td style="font-size:18px;font-weight:bold;padding-bottom:14px">Nueva solicitud de demo · IONIX</td></tr>
      ${filled.map(([k, v]) => `<tr><td style="font-size:14px;padding:4px 0"><b>${esc(k)}:</b> ${esc(String(v))}</td></tr>`).join("")}
      <tr><td style="padding-top:18px"><a href="${esc(panelUrl)}" style="color:#0e7490">Ver en el panel (Solicitudes)</a></td></tr>
    </table>
  </td></tr></table></body></html>`;
  return { subject, text, html };
}

/** Envía sin bloquear la respuesta (y sin revelar por el tiempo de respuesta si el email existe). */
export function sendInBackground(send: () => Promise<void>, context: Record<string, unknown>) {
  send().catch((err) => tenancy.observability.logger.error({ err, ...context }, "no se pudo enviar el correo"));
}
