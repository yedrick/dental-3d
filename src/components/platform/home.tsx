import { useEffect, useRef, useState, type ReactNode } from "react";
import { MotionConfig, motion, useScroll, useTransform } from "motion/react";
import { ArrowRight, Check, ChevronDown, Lock, Menu, MessageCircle, Sparkles, X, Zap } from "lucide-react";
import { CORE, FAQ, PROBLEMS, SECURITY, STEPS } from "./data";
import { usePlatform, whatsappUrl } from "./platform";
import { ProductMockup } from "./mockup";
import { PlansSection } from "./plans";
import { DemoForm } from "./demo-form";
import { IonixLogo } from "./logo";

const NAV = [
  { href: "#modulos", label: "Módulos" },
  { href: "#planes", label: "Planes" },
  { href: "#seguridad", label: "Seguridad" },
  { href: "#preguntas", label: "Preguntas" },
];

/** Aparece al entrar en pantalla (una sola vez). */
function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: ReactNode; text?: string }) {
  return (
    <Reveal className="mx-auto mb-12 max-w-2xl text-center">
      <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-1 text-xs font-medium tracking-wide text-cyan-200">
        {eyebrow}
      </div>
      <h2 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{title}</h2>
      {text && <p className="mt-4 text-white/60">{text}</p>}
    </Reveal>
  );
}

/** Tipografías de la web comercial (solo en el dominio principal). */
function useDisplayFonts() {
  useEffect(() => {
    const id = "ionix-fonts";
    if (document.getElementById(id)) return;
    const link = Object.assign(document.createElement("link"), {
      id,
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Sora:wght@600;700;800&display=swap",
    });
    document.head.appendChild(link);
  }, []);
}

/**
 * Web comercial de IONIX en el dominio principal (ionix.kollatech.site). Cada clínica tiene su propia
 * página en su subdominio; esta vende la plataforma: módulos, planes (desde la configuración) y
 * "Solicitar demo" (llega al panel → Solicitudes).
 */
export default function PlatformHome() {
  useDisplayFonts();
  const [menuOpen, setMenuOpen] = useState(false);
  const [plan, setPlan] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: heroRef, offset: ["start start", "end start"] });
  const heroY = useTransform(scrollYProgress, [0, 1], [0, 120]);
  const heroOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const choosePlan = (id: string) => {
    setPlan(id);
    document.getElementById("demo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const platform = usePlatform();
  const CONTACT = platform.contact;
  // Nombre de la plataforma (panel → Plataforma) en la pestaña y en la descripción para buscadores
  useEffect(() => {
    document.title = `${platform.name} · Sistema para centros de radiología dental`;
    document.querySelector('meta[name="description"]')?.setAttribute(
      "content",
      `${platform.name}: pacientes, atenciones, cobros, comisiones, caja, reportes y página web para tu centro de radiología dental. Solicita tu demo.`,
    );
  }, [platform.name]);
  // Ícono de la pestaña subido en el panel (Plataforma)
  useEffect(() => {
    if (!platform.faviconUrl) return;
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) icon.href = platform.faviconUrl;
  }, [platform.faviconUrl]);
  const wa = whatsappUrl(CONTACT.whatsapp, `Hola, quiero información sobre ${platform.name} para mi clínica.`);

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-h-screen overflow-x-hidden bg-[#070b1d] font-[Inter,ui-sans-serif,system-ui,sans-serif] text-white antialiased">
        {/* Fondo: brillos y cuadrícula */}
        <div aria-hidden className="pointer-events-none fixed inset-0">
          <div className="absolute -top-48 left-1/2 h-[640px] w-[900px] -translate-x-1/2 rounded-full bg-cyan-500/[0.13] blur-[140px]" />
          <div className="absolute top-[45%] -right-48 h-[520px] w-[520px] rounded-full bg-indigo-600/[0.16] blur-[130px]" />
          <div className="absolute bottom-[-10%] -left-40 h-[480px] w-[480px] rounded-full bg-fuchsia-600/[0.08] blur-[120px]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]" />
        </div>

        {/* MENÚ */}
        <header className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${scrolled ? "border-b border-white/5 bg-[#070b1d]/80 backdrop-blur-xl" : ""}`}>
          <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6" aria-label="Principal">
            <a href="#" aria-label={`${platform.name}, inicio`}><IonixLogo logoUrl={platform.logoUrl} name={platform.name} /></a>
            <div className="hidden items-center gap-8 text-sm text-white/70 md:flex">
              {NAV.map((n) => <a key={n.href} href={n.href} className="transition hover:text-white">{n.label}</a>)}
            </div>
            <div className="flex items-center gap-2">
              <a href="#demo" className="hidden rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#070b1d] transition hover:bg-cyan-100 sm:inline-flex">
                Solicitar demo
              </a>
              <button type="button" className="rounded-lg p-2 md:hidden" aria-label={menuOpen ? "Cerrar menú" : "Abrir menú"} aria-expanded={menuOpen} onClick={() => setMenuOpen((v) => !v)}>
                {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
              </button>
            </div>
          </nav>
          {menuOpen && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="border-t border-white/5 bg-[#070b1d]/95 px-4 pb-5 backdrop-blur-xl md:hidden">
              {[...NAV, { href: "#demo", label: "Solicitar demo" }].map((n) => (
                <a key={n.href} href={n.href} onClick={() => setMenuOpen(false)} className="block border-b border-white/5 py-3 text-white/80">{n.label}</a>
              ))}
            </motion.div>
          )}
        </header>

        <main className="relative">
          {/* PORTADA */}
          <section ref={heroRef} className="mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-32 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-40">
            <motion.div style={{ y: heroY, opacity: heroOpacity }}>
              <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70">
                <Zap className="h-3.5 w-3.5 text-cyan-300" /> Hecho para centros de radiología dental
              </motion.div>
              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1, duration: 0.7 }}
                className="font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl"
              >
                Tu centro de radiología,{" "}
                <span className="bg-gradient-to-r from-cyan-200 via-cyan-300 to-indigo-300 bg-clip-text text-transparent">bajo control</span>{" "}
                desde la primera atención.
              </motion.h1>
              <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="mt-6 max-w-xl text-lg text-white/65">
                Pacientes, atenciones, cobros, comisiones de doctores, caja, reportes y la página web de tu clínica.
                Todo en IONIX, en la nube, desde la computadora o el celular.
              </motion.p>
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="mt-9 flex flex-wrap gap-3">
                <a href="#demo" className="group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-300 to-indigo-400 px-6 py-3.5 font-semibold text-[#070b1d] shadow-lg shadow-cyan-500/25 transition hover:brightness-110">
                  Solicitar demo <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                </a>
                <a href="#planes" className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-3.5 font-semibold transition hover:bg-white/10">
                  Ver planes
                </a>
              </motion.div>
              <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/55">
                {["Sin instalar nada", "Base de datos propia", "Subdominio para tu clínica"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5"><Check className="h-4 w-4 text-cyan-300" />{t}</li>
                ))}
              </motion.ul>
            </motion.div>
            <ProductMockup />
          </section>

          {/* ANTES / CON IONIX */}
          <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Lo que resuelve" title={<>Menos papeles. <span className="text-cyan-300">Más control.</span></>} text="Lo que hoy se pierde entre cuadernos, planillas y mensajes, en IONIX queda registrado y a la vista." />
            <div className="grid gap-4 md:grid-cols-2">
              {PROBLEMS.map((p, i) => (
                <Reveal key={i} delay={i * 0.08}>
                  <div className="group h-full rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-cyan-300/30 hover:bg-white/[0.05]">
                    <p className="text-sm text-white/45 line-through decoration-rose-400/50">{p.before}</p>
                    <div className="my-4 h-px bg-gradient-to-r from-cyan-300/40 to-transparent" />
                    <p className="flex gap-3 text-white/85"><Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-cyan-300" />{p.after}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* MÓDULOS */}
          <section id="modulos" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Módulos" title="Todo tu centro, en un solo sistema" text="Esto viene en todos los planes. Agenda, caja, comisiones, reportes, página web y más se suman según tu plan." />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {CORE.map((m, i) => (
                <Reveal key={m.title} delay={(i % 4) * 0.07}>
                  <motion.div whileHover={{ y: -4 }} className="h-full rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.05] to-transparent p-5">
                    <div className="mb-4 grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-cyan-300/20 to-indigo-400/20 ring-1 ring-white/10">
                      <m.icon className="h-5 w-5 text-cyan-200" />
                    </div>
                    <h3 className="font-semibold">{m.title}</h3>
                    <p className="mt-1.5 text-sm text-white/55">{m.text}</p>
                  </motion.div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* CÓMO FUNCIONA */}
          <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Cómo empiezas" title="De la demo a tu primera atención" />
            <div className="relative grid gap-6 md:grid-cols-3">
              <motion.div
                aria-hidden
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 1.2, ease: "easeInOut" }}
                className="absolute left-[16%] right-[16%] top-7 hidden h-px origin-left bg-gradient-to-r from-cyan-300/60 via-indigo-300/60 to-fuchsia-300/40 md:block"
              />
              {STEPS.map((s, i) => (
                <Reveal key={s.title} delay={i * 0.15} className="relative text-center">
                  <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-cyan-300/30 bg-[#0b1230] font-display text-xl font-bold text-cyan-200 shadow-lg shadow-cyan-500/10">
                    {i + 1}
                  </div>
                  <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
                  <p className="mx-auto mt-2 max-w-xs text-sm text-white/55">{s.text}</p>
                </Reveal>
              ))}
            </div>
          </section>

          {/* PLANES */}
          <section id="planes" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Planes" title="Elige el plan de tu clínica" text="Cambia de plan cuando quieras. Si bajas de plan, tus datos se guardan." />
            <PlansSection onChoose={choosePlan} />
          </section>

          {/* SEGURIDAD */}
          <section id="seguridad" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-20 sm:px-6">
            <div className="grid items-center gap-12 rounded-[2rem] border border-white/10 bg-gradient-to-br from-white/[0.05] to-white/[0.01] p-8 sm:p-12 lg:grid-cols-[0.9fr_1.1fr]">
              <Reveal>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-cyan-300/10 ring-1 ring-cyan-300/30">
                  <Lock className="h-7 w-7 text-cyan-200" />
                </div>
                <h2 className="mt-6 font-display text-3xl font-bold leading-tight">Los datos de tus pacientes, separados y protegidos</h2>
                <p className="mt-4 text-white/60">Cada clínica vive en su propio espacio. Nadie de otra clínica puede ver tu información.</p>
              </Reveal>
              <ul className="space-y-3">
                {SECURITY.map((s, i) => (
                  <Reveal key={s} delay={i * 0.06}>
                    <li className="flex gap-3 rounded-xl border border-white/5 bg-[#070b1d]/50 p-4 text-sm text-white/80">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /> {s}
                    </li>
                  </Reveal>
                ))}
              </ul>
            </div>
          </section>

          {/* PREGUNTAS */}
          <section id="preguntas" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Preguntas frecuentes" title="Lo que más nos preguntan" />
            <div className="space-y-3">
              {FAQ.map((f, i) => (
                <Reveal key={f.q} delay={i * 0.04}>
                  <details className="group rounded-2xl border border-white/10 bg-white/[0.03] p-5 open:border-cyan-300/30 open:bg-white/[0.05]">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                      {f.q}
                      <ChevronDown className="h-5 w-5 shrink-0 text-white/50 transition group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 text-sm leading-relaxed text-white/60">{f.a}</p>
                  </details>
                </Reveal>
              ))}
            </div>
          </section>

          {/* SOLICITAR DEMO */}
          <section id="demo" className="mx-auto max-w-4xl scroll-mt-24 px-4 py-20 sm:px-6">
            <SectionTitle eyebrow="Solicitar demo" title={<>Mira IONIX funcionando <span className="text-cyan-300">con tu clínica</span></>} text="Déjanos tus datos y te mostramos el sistema con estudios y tarifas como los tuyos." />
            <Reveal><DemoForm plan={plan} /></Reveal>
            {(wa || CONTACT.email) && (
              <p className="mt-6 text-center text-sm text-white/55">
                ¿Prefieres escribirnos?{" "}
                {wa && <a href={wa} target="_blank" rel="noreferrer" className="text-cyan-300 hover:underline">WhatsApp</a>}
                {wa && CONTACT.email && " · "}
                {CONTACT.email && <a href={`mailto:${CONTACT.email}`} className="text-cyan-300 hover:underline">{CONTACT.email}</a>}
              </p>
            )}
          </section>
        </main>

        {/* PIE */}
        <footer className="relative border-t border-white/5">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-white/45 sm:flex-row sm:px-6">
            <IonixLogo className="text-white/80" logoUrl={platform.logoUrl} name={platform.name} />
            <div className="flex flex-wrap justify-center gap-5">
              {NAV.map((n) => <a key={n.href} href={n.href} className="hover:text-white">{n.label}</a>)}
              <a href="/privacidad" className="hover:text-white">Privacidad</a>
            </div>
            <span>© {new Date().getFullYear()} IONIX</span>
          </div>
        </footer>

        {/* WhatsApp flotante (solo si está configurado) */}
        {wa && (
          <motion.a
            href={wa}
            target="_blank"
            rel="noreferrer"
            aria-label="Escribir por WhatsApp"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 1.5, type: "spring" }}
            whileHover={{ scale: 1.08 }}
            className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-emerald-500 text-white shadow-xl shadow-emerald-500/30"
          >
            <MessageCircle className="h-7 w-7" />
          </motion.a>
        )}
      </div>
    </MotionConfig>
  );
}
