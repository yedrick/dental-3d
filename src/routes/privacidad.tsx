import { createFileRoute } from "@tanstack/react-router";
import { IonixLogo } from "@/components/platform/logo";
import { usePlatform } from "@/components/platform/platform";

// Aviso de privacidad del formulario "Solicitar demo" de la web comercial. Revisar con un asesor legal.
export const Route = createFileRoute("/privacidad")({
  head: () => ({ meta: [{ title: "Privacidad · IONIX" }, { name: "robots", content: "noindex" }] }),
  component: Privacy,
});

function Privacy() {
  const { contact: CONTACT, logoUrl, name } = usePlatform();
  return (
    <div className="min-h-screen bg-[#070b1d] px-4 py-12 text-white sm:px-6">
      <article className="mx-auto max-w-2xl space-y-5 text-sm leading-relaxed text-white/75">
        <a href="/" aria-label={`${name}, inicio`}><IonixLogo logoUrl={logoUrl} name={name} /></a>
        <h1 className="pt-4 text-2xl font-bold text-white">Privacidad</h1>
        <p>
          Cuando llenas el formulario <b>Solicitar demo</b> guardamos los datos que escribes (nombre, clínica, ciudad,
          WhatsApp, correo, plan de interés y mensaje), la fecha en que aceptaste ser contactado y la dirección IP desde
          la que se envió, para evitar envíos automáticos.
        </p>
        <p>Usamos esos datos <b>solo para contactarte sobre la demo y los planes de IONIX</b>. No los vendemos ni los compartimos con terceros.</p>
        <p>
          Los datos de los pacientes que cada clínica registra en IONIX pertenecen a esa clínica: se guardan en su propia
          base de datos, separada de las demás, y solo acceden las personas que la clínica autoriza.
        </p>
        <p>
          Para pedir que borremos tus datos de contacto
          {CONTACT.email ? <> escríbenos a <a className="text-cyan-300" href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></> : " escríbenos por los medios de contacto de esta página"}.
        </p>
        <p><a href="/" className="text-cyan-300 hover:underline">← Volver al inicio</a></p>
      </article>
    </div>
  );
}
