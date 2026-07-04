import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Activity, ShieldCheck, Clock, MapPin, Phone, MessageCircle,
  ScanLine, Sparkles, ArrowRight, CheckCircle2, Loader2,
} from "lucide-react";
import logoAsset from "@/assets/logo-3d.png.asset.json";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "3 Dental Imagen · Radiología Dental 2D y 3D en Bolivia" },
      { name: "description", content: "Centro de radiología dental en Bolivia. Estudios 2D y 3D (CBCT) con entrega ágil. Agenda por WhatsApp al 77726685." },
      { property: "og:title", content: "3 Dental Imagen · Radiología Dental 2D y 3D" },
      { property: "og:description", content: "Estudios radiológicos dentales 2D y 3D con la última tecnología. Agenda tu cita por WhatsApp." },
      { property: "og:url", content: "https://3d.kollatek.com/" },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: "3 Dental Imagen · Radiología Dental" },
      { name: "twitter:description", content: "Estudios radiológicos dentales 2D y 3D. Agenda por WhatsApp." },
    ],
    links: [{ rel: "canonical", href: "https://3d.kollatek.com/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "MedicalBusiness",
          name: "3 Dental Imagen",
          description: "Centro radiológico dental especializado en imagen 2D y 3D.",
          url: "https://3d.kollatek.com/",
          telephone: "+591-77726685",
          address: { "@type": "PostalAddress", addressCountry: "BO" },
          openingHours: ["Mo-Fr 08:00-19:00", "Sa 08:00-13:00"],
        }),
      },
    ],
  }),
  component: Landing,
});

const CONTACT = {
  name: "3 Dental Imagen",
  tagline: "Centro Radiológico Dental",
  phone: "77726685",
  whatsapp: "59177726685",
  address: "Bolivia",
  hours: [
    { d: "Lunes a Viernes", h: "08:00 – 19:00" },
    { d: "Sábado", h: "08:00 – 13:00" },
    { d: "Domingo", h: "Cerrado" },
  ],
};

function Landing() {
  const { user, loading } = useAuth();
  const { data: studies, isLoading: sLoading } = useQuery({
    queryKey: ["public-studies"],
    queryFn: async () => {
      const { data } = await supabase.from("studies").select("id,name,description").eq("active", true).order("name");
      return data ?? [];
    },
  });

  if (loading) return (
    <div className="grid min-h-screen place-items-center bg-[#0a1230]">
      <Loader2 className="h-8 w-8 animate-spin text-white/80" />
    </div>
  );
  if (user) return <Navigate to="/app" />;

  return (
    <div className="min-h-screen bg-[#0a1230] text-white overflow-x-hidden">
      {/* Background glow */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-0">
        <div className="absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-[#3b6fa0]/25 blur-[120px]" />
        <div className="absolute top-[40%] -right-40 h-[500px] w-[500px] rounded-full bg-[#4f46e5]/20 blur-[120px]" />
        <div className="absolute bottom-0 -left-40 h-[500px] w-[500px] rounded-full bg-[#1e3a5f]/40 blur-[100px]" />
      </div>

      <div className="relative z-10">
        {/* NAV */}
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-6">
          <Link to="/" className="flex items-center gap-2 sm:gap-3">
            <img src={logoAsset.url} alt="3 Dental Imagen" className="h-10 w-10 sm:h-12 sm:w-12 drop-shadow-[0_4px_20px_rgba(79,70,229,0.5)]" />
            <div className="leading-tight">
              <div className="text-sm sm:text-base font-bold tracking-tight">{CONTACT.name}</div>
              <div className="text-[10px] sm:text-xs text-white/60">{CONTACT.tagline}</div>
            </div>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={`https://wa.me/${CONTACT.whatsapp}`}
              target="_blank" rel="noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-medium hover:bg-white/10"
            >
              <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
            </a>
            <Button asChild size="sm" className="bg-white text-[#0a1230] hover:bg-white/90">
              <Link to="/auth">Ingresar</Link>
            </Button>
          </div>
        </header>

        {/* HERO */}
        <section className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
          <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs backdrop-blur">
                <Sparkles className="h-3 w-3 text-[#8ba9ff]" />
                Radiología dental de alta precisión
              </div>
              <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl md:text-6xl">
                Imagen dental{" "}
                <span className="bg-gradient-to-r from-[#8ba9ff] via-[#5b7fd6] to-[#3b6fa0] bg-clip-text text-transparent">
                  clara, rápida y confiable.
                </span>
              </h1>
              <p className="mt-5 max-w-lg text-base text-white/70 sm:text-lg">
                Estudios radiológicos 2D y 3D para profesionales y pacientes.
                Diagnóstico preciso con la última tecnología en imagen dental.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <a
                  href={`https://wa.me/${CONTACT.whatsapp}?text=Hola,%20quisiera%20agendar%20un%20estudio`}
                  target="_blank" rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-3 text-sm font-semibold text-[#0a1230] shadow-[0_10px_40px_-10px_rgba(255,255,255,0.4)] transition hover:scale-[1.02]"
                >
                  <MessageCircle className="h-4 w-4" /> Agendar por WhatsApp
                </a>
                <a
                  href="#estudios"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold backdrop-blur hover:bg-white/10"
                >
                  Ver estudios <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              <div className="mt-10 grid grid-cols-3 gap-3 sm:gap-6">
                {[
                  { n: "10+", l: "Años de experiencia" },
                  { n: "3D", l: "Tomografía CBCT" },
                  { n: "24h", l: "Entrega ágil" },
                ].map((s) => (
                  <div key={s.l} className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4 backdrop-blur">
                    <div className="text-xl font-bold sm:text-2xl">{s.n}</div>
                    <div className="mt-0.5 text-[10px] text-white/60 sm:text-xs">{s.l}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Logo showcase */}
            <div className="relative mx-auto flex w-full max-w-md items-center justify-center lg:max-w-none">
              <div className="absolute inset-0 rounded-full bg-gradient-to-br from-[#4f46e5]/40 to-[#3b6fa0]/20 blur-3xl" />
              <div className="relative">
                <div className="absolute -inset-8 rounded-full border border-white/10" />
                <div className="absolute -inset-16 rounded-full border border-white/5" />
                <img
                  src={logoAsset.url}
                  alt="3 Dental Imagen"
                  className="relative h-64 w-64 sm:h-80 sm:w-80 drop-shadow-[0_20px_60px_rgba(79,70,229,0.5)] animate-[spin_40s_linear_infinite]"
                  style={{ animationDirection: "reverse" }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ESTUDIOS */}
        <section id="estudios" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
          <div className="mb-8 sm:mb-12">
            <div className="text-xs font-semibold uppercase tracking-widest text-[#8ba9ff]">Servicios</div>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">Estudios disponibles</h2>
            <p className="mt-3 max-w-2xl text-sm text-white/60 sm:text-base">
              Contáctanos por WhatsApp para consultar precios, disponibilidad y agendar tu estudio.
            </p>
          </div>

          {sLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
              ))}
            </div>
          ) : studies && studies.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {studies.map((s, i) => (
                <div
                  key={s.id}
                  className="group relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.07] to-white/[0.02] p-5 backdrop-blur transition hover:-translate-y-1 hover:border-[#5b7fd6]/50"
                >
                  <div className="absolute -right-8 -top-8 h-24 w-24 rounded-full bg-[#4f46e5]/20 blur-2xl transition group-hover:bg-[#4f46e5]/40" />
                  <div className="relative">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-[#8ba9ff]">
                      <ScanLine className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 font-semibold leading-tight">{s.name}</h3>
                    {s.description && (
                      <p className="mt-2 line-clamp-3 text-xs text-white/60">{s.description}</p>
                    )}
                    <div className="mt-4 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-[#8ba9ff]/80">
                      <CheckCircle2 className="h-3 w-3" /> Disponible
                    </div>
                  </div>
                  <div className="text-xs text-white/40 mt-1">Estudio #{i + 1}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/5 p-8 text-center text-sm text-white/60">
              Estamos actualizando nuestro catálogo. Escríbenos por WhatsApp.
            </div>
          )}
        </section>

        {/* INFO / CONTACTO */}
        <section className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
          <div className="grid gap-4 md:grid-cols-3">
            <InfoCard icon={Clock} title="Horarios de atención">
              <ul className="space-y-1.5 text-sm">
                {CONTACT.hours.map((h) => (
                  <li key={h.d} className="flex justify-between gap-3">
                    <span className="text-white/70">{h.d}</span>
                    <span className="font-medium">{h.h}</span>
                  </li>
                ))}
              </ul>
            </InfoCard>
            <InfoCard icon={Phone} title="Contáctanos">
              <div className="space-y-2 text-sm">
                <a href={`tel:${CONTACT.phone}`} className="flex items-center gap-2 hover:text-[#8ba9ff]">
                  <Phone className="h-4 w-4 text-[#8ba9ff]" /> {CONTACT.phone}
                </a>
                <a
                  href={`https://wa.me/${CONTACT.whatsapp}`}
                  target="_blank" rel="noreferrer"
                  className="flex items-center gap-2 hover:text-[#8ba9ff]"
                >
                  <MessageCircle className="h-4 w-4 text-[#8ba9ff]" /> WhatsApp directo
                </a>
              </div>
            </InfoCard>
            <InfoCard icon={MapPin} title="Ubicación">
              <p className="text-sm text-white/70">
                {CONTACT.address}
              </p>
              <p className="mt-2 text-xs text-white/50">
                Consulta la dirección exacta al agendar.
              </p>
            </InfoCard>
          </div>
        </section>

        {/* CTA FINAL */}
        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-[#1e3a5f] to-[#0a1230] p-8 sm:p-14">
            <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-[#4f46e5]/30 blur-3xl" />
            <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-[#3b6fa0]/40 blur-3xl" />
            <div className="relative">
              <h2 className="text-2xl font-bold sm:text-4xl">¿Listo para tu estudio?</h2>
              <p className="mt-3 max-w-lg text-sm text-white/70 sm:text-base">
                Escríbenos por WhatsApp y agenda tu cita. Recibirás tus imágenes en formato digital y físico.
              </p>
              <a
                href={`https://wa.me/${CONTACT.whatsapp}?text=Hola,%20quisiera%20agendar%20un%20estudio`}
                target="_blank" rel="noreferrer"
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-bold text-[#0a1230] transition hover:scale-[1.03]"
              >
                <MessageCircle className="h-4 w-4" /> Agendar ahora
              </a>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="border-t border-white/10">
          <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 text-xs text-white/50 sm:flex-row sm:px-6">
            <div className="flex items-center gap-2">
              <img src={logoAsset.url} alt="" className="h-6 w-6" />
              <span>© {new Date().getFullYear()} {CONTACT.name}. Todos los derechos reservados.</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3 w-3" /> Datos protegidos</span>
              <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" /> Servicio profesional</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function InfoCard({
  icon: Icon, title, children,
}: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
      <div className="flex items-center gap-2">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-[#8ba9ff]">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}
