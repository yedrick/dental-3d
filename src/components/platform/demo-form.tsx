import { useEffect, useId, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { CheckCircle2, Loader2, Send } from "lucide-react";
import { usePublicPlans } from "./plans";

type Fields = { name: string; company: string; city: string; phone: string; email: string; plan: string; message: string };
const EMPTY: Fields = { name: "", company: "", city: "", phone: "", email: "", plan: "", message: "" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+()\s.-]*$/;

/** Revisión en español antes de enviar (la API repite las mismas reglas). */
function validate(f: Fields, consent: boolean) {
  const e: Partial<Record<keyof Fields | "consent", string>> = {};
  if (f.name.trim().length < 2) e.name = "Escribe tu nombre.";
  if (!f.email.trim() && !f.phone.trim()) e.phone = "Déjanos tu WhatsApp o tu correo para contactarte.";
  if (f.email.trim() && !EMAIL.test(f.email.trim())) e.email = "Revisa el correo.";
  if (f.phone.trim() && (!PHONE.test(f.phone) || f.phone.replace(/\D/g, "").length < 7)) e.phone = "Revisa el número (solo números, +, espacios o guiones).";
  if (!consent) e.consent = "Necesitamos tu permiso para contactarte.";
  return e;
}

/**
 * "Solicitar demo": POST /admin/api/leads (tenancy-node). La solicitud queda en el panel → Solicitudes
 * y, si SALES_NOTIFY_TO está configurado, llega un aviso por correo. `website` es un campo trampa para bots.
 */
export function DemoForm({ plan }: { plan: string }) {
  const uid = useId();
  const { data: plans } = usePublicPlans();
  const [f, setF] = useState<Fields>({ ...EMPTY, plan });
  const [consent, setConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({});
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [serverError, setServerError] = useState("");

  useEffect(() => setF((s) => ({ ...s, plan })), [plan]);

  const set = (k: keyof Fields) => (ev: { target: { value: string } }) => setF((s) => ({ ...s, [k]: ev.target.value }));

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (state === "sending") return;
    const e = validate(f, consent);
    setErrors(e);
    setServerError("");
    if (Object.keys(e).length) return;
    setState("sending");
    const orNull = (v: string) => v.trim() || null;
    try {
      const res = await fetch("/admin/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name.trim(), company: orNull(f.company), city: orNull(f.city), phone: orNull(f.phone),
          email: orNull(f.email), plan: orNull(f.plan), message: orNull(f.message), consent, website: trap,
        }),
      });
      if (res.status === 201) {
        setState("done");
        return;
      }
      setState("idle");
      if (res.status === 429) setServerError("Recibimos varias solicitudes desde tu conexión. Intenta de nuevo en una hora o escríbenos por WhatsApp.");
      else setServerError("No pudimos enviar la solicitud. Revisa los datos e intenta otra vez.");
    } catch {
      setState("idle");
      setServerError("Sin conexión. Revisa tu internet e intenta otra vez.");
    }
  };

  if (state === "done")
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center rounded-3xl border border-emerald-300/30 bg-emerald-400/[0.07] p-10 text-center"
        role="status"
      >
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 15, delay: 0.1 }}>
          <CheckCircle2 className="h-14 w-14 text-emerald-300" />
        </motion.div>
        <h3 className="mt-4 font-display text-2xl font-semibold">¡Solicitud recibida!</h3>
        <p className="mt-2 max-w-sm text-white/70">Te contactaremos pronto para coordinar tu demo. Gracias por tu interés en IONIX.</p>
      </motion.div>
    );

  const input = "w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-white/30 outline-none transition focus:border-cyan-300/60 focus:bg-white/[0.06] focus:ring-2 focus:ring-cyan-300/20";
  const label = "mb-1.5 block text-xs font-medium text-white/70";
  const err = (k: keyof typeof errors) =>
    errors[k] ? <p id={`${uid}-${k}-err`} className="mt-1 text-xs text-rose-300">{errors[k]}</p> : null;
  const aria = (k: keyof typeof errors) => ({ "aria-invalid": !!errors[k] || undefined, "aria-describedby": errors[k] ? `${uid}-${k}-err` : undefined });

  return (
    <form onSubmit={submit} noValidate className="grid gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6 sm:grid-cols-2 sm:p-8">
      <div>
        <label htmlFor={`${uid}-name`} className={label}>Nombre *</label>
        <input id={`${uid}-name`} className={input} value={f.name} onChange={set("name")} autoComplete="name" maxLength={150} {...aria("name")} />
        {err("name")}
      </div>
      <div>
        <label htmlFor={`${uid}-company`} className={label}>Clínica o centro</label>
        <input id={`${uid}-company`} className={input} value={f.company} onChange={set("company")} autoComplete="organization" maxLength={150} />
      </div>
      <div>
        <label htmlFor={`${uid}-phone`} className={label}>WhatsApp</label>
        <input id={`${uid}-phone`} className={input} value={f.phone} onChange={set("phone")} inputMode="tel" autoComplete="tel" placeholder="+591 7…" maxLength={50} {...aria("phone")} />
        {err("phone")}
      </div>
      <div>
        <label htmlFor={`${uid}-email`} className={label}>Correo</label>
        <input id={`${uid}-email`} type="email" className={input} value={f.email} onChange={set("email")} autoComplete="email" maxLength={191} {...aria("email")} />
        {err("email")}
      </div>
      <div>
        <label htmlFor={`${uid}-city`} className={label}>Ciudad</label>
        <input id={`${uid}-city`} className={input} value={f.city} onChange={set("city")} autoComplete="address-level2" maxLength={100} />
      </div>
      <div>
        <label htmlFor={`${uid}-plan`} className={label}>Plan de interés</label>
        <select id={`${uid}-plan`} className={`${input} appearance-none`} value={f.plan} onChange={set("plan")}>
          <option value="" className="bg-[#0d1530]">Todavía no sé</option>
          {plans?.plans.map((p) => <option key={p.id} value={p.id} className="bg-[#0d1530]">{p.label}</option>)}
        </select>
      </div>
      <div className="sm:col-span-2">
        <label htmlFor={`${uid}-message`} className={label}>Cuéntanos de tu clínica (opcional)</label>
        <textarea id={`${uid}-message`} className={`${input} min-h-[96px] resize-y`} value={f.message} onChange={set("message")} maxLength={2000} placeholder="Cuántas personas atienden, qué estudios hacen, cómo cobran hoy…" />
      </div>

      {/* Campo trampa: invisible para personas; si un bot lo llena, la solicitud se descarta */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor={`${uid}-website`}>Sitio web</label>
        <input id={`${uid}-website`} tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
      </div>

      <div className="sm:col-span-2">
        <label className="flex cursor-pointer items-start gap-3 text-sm text-white/70">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 accent-cyan-300" {...aria("consent")} />
          <span>
            Acepto que IONIX use estos datos solo para contactarme sobre la demo. Ver{" "}
            <a href="/privacidad" className="text-cyan-300 underline-offset-2 hover:underline">privacidad</a>.
          </span>
        </label>
        {err("consent")}
      </div>

      <AnimatePresence>
        {serverError && (
          <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="text-sm text-rose-300 sm:col-span-2">
            {serverError}
          </motion.p>
        )}
      </AnimatePresence>

      <button
        type="submit"
        disabled={state === "sending"}
        className="group inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-indigo-400 px-6 py-3.5 font-semibold text-[#070b1d] shadow-lg shadow-cyan-500/20 transition hover:brightness-110 disabled:opacity-60 sm:col-span-2"
      >
        {state === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4 transition group-hover:translate-x-0.5" />}
        {state === "sending" ? "Enviando…" : "Solicitar mi demo"}
      </button>
    </form>
  );
}
