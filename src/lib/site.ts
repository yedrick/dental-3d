import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { STALE } from "@/lib/query-config";

// Contenido de la página web pública de la sucursal (GET /api/public/site). Se guarda en la base
// de cada sucursal y se edita en "Página web" (permiso site.edit). La API ya lo devuelve completo,
// con los valores por defecto; estos de aquí solo se usan en el dominio central (sin sucursal).

export interface SiteContent {
  seo: { title: string; description: string };
  hero: { badge: string; title: string; highlight: string; subtitle: string; cta_label: string; image: string };
  stats: { value: string; label: string }[];
  studies: { title: string; subtitle: string; empty: string };
  contact: {
    phone: string; whatsapp: string; whatsapp_message: string; email: string;
    address: string; address_note: string; map_url: string;
  };
  hours: { day: string; hours: string }[];
  cta: { title: string; subtitle: string };
  social: { facebook: string; instagram: string; tiktok: string };
  footer: { name: string };
}

export const DEFAULT_SITE: SiteContent = {
  seo: {
    title: "3 Dental Imagen · Radiología Dental 2D y 3D en Bolivia",
    description: "Centro de radiología dental en Bolivia. Estudios 2D y 3D (CBCT) con entrega ágil. Agenda por WhatsApp.",
  },
  hero: {
    badge: "Radiología dental de alta precisión",
    title: "Imagen dental",
    highlight: "clara, rápida y confiable.",
    subtitle: "Estudios radiológicos 2D y 3D para profesionales y pacientes. Diagnóstico preciso con la última tecnología en imagen dental.",
    cta_label: "Agendar por WhatsApp",
    image: "",
  },
  stats: [
    { value: "10+", label: "Años de experiencia" },
    { value: "3D", label: "Tomografía CBCT" },
    { value: "24h", label: "Entrega ágil" },
  ],
  studies: {
    title: "Estudios disponibles",
    subtitle: "Contáctanos por WhatsApp para consultar precios, disponibilidad y agendar tu estudio.",
    empty: "Estamos actualizando nuestro catálogo. Escríbenos por WhatsApp.",
  },
  contact: {
    phone: "77726685", whatsapp: "59177726685", whatsapp_message: "Hola, quisiera agendar un estudio",
    email: "", address: "Bolivia", address_note: "Consulta la dirección exacta al agendar.", map_url: "",
  },
  hours: [
    { day: "Lunes a Viernes", hours: "08:00 – 19:00" },
    { day: "Sábado", hours: "08:00 – 13:00" },
    { day: "Domingo", hours: "Cerrado" },
  ],
  cta: {
    title: "¿Listo para tu estudio?",
    subtitle: "Escríbenos por WhatsApp y agenda tu cita. Recibirás tus imágenes en formato digital y físico.",
  },
  social: { facebook: "", instagram: "", tiktok: "" },
  footer: { name: "3 Dental Imagen" },
};

export function useSiteContent() {
  return useQuery({
    queryKey: ["public-site"],
    queryFn: async () => {
      try {
        return await apiGet<SiteContent>("/api/public/site");
      } catch {
        return DEFAULT_SITE; // dominio central o sucursal inexistente
      }
    },
    staleTime: STALE.catalog,
  });
}

/** Enlace de WhatsApp con mensaje opcional. */
export function whatsappLink(site: SiteContent, withMessage = false) {
  const base = `https://wa.me/${site.contact.whatsapp}`;
  return withMessage && site.contact.whatsapp_message
    ? `${base}?text=${encodeURIComponent(site.contact.whatsapp_message)}`
    : base;
}
