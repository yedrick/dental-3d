import { useQuery } from "@tanstack/react-query";

// Marca y contacto de la plataforma IONIX (dominio principal), editables en el panel /admin → Plataforma
// (tenancy-node 0.12, GET /tenancy/platform). Si la API todavía no lo tiene, se usan los valores del
// .env al compilar (VITE_IONIX_WHATSAPP / VITE_IONIX_EMAIL) y el logo de texto.

export type Platform = {
  name: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primary: string | null;
  contact: { whatsapp: string; email: string };
};

const FALLBACK: Platform = {
  name: "IONIX",
  logoUrl: null,
  faviconUrl: null,
  primary: null,
  contact: {
    whatsapp: ((import.meta.env.VITE_IONIX_WHATSAPP as string | undefined) ?? "").replace(/\D/g, ""),
    email: (import.meta.env.VITE_IONIX_EMAIL as string | undefined)?.trim() ?? "",
  },
};

export function usePlatform(): Platform {
  const { data } = useQuery({
    queryKey: ["platform"],
    queryFn: async (): Promise<Platform> => {
      const res = await fetch("/tenancy/platform", { headers: { Accept: "application/json" } });
      if (!res.ok) return FALLBACK;
      // Campos sin guardar en el panel llegan en null: se usa el respaldo
      const p = (await res.json()) as Partial<{
        name: string | null; logoUrl: string | null; faviconUrl: string | null; primary: string | null;
        contact: { whatsapp?: string | null; email?: string | null } | null;
      }>;
      return {
        name: p.name || FALLBACK.name,
        logoUrl: p.logoUrl || null,
        faviconUrl: p.faviconUrl || null,
        primary: p.primary || null,
        contact: {
          whatsapp: (p.contact?.whatsapp ?? "").replace(/\D/g, "") || FALLBACK.contact.whatsapp,
          email: p.contact?.email?.trim() || FALLBACK.contact.email,
        },
      };
    },
    staleTime: 5 * 60_000,
  });
  return data ?? FALLBACK;
}

export const whatsappUrl = (number: string, text: string) =>
  number ? `https://wa.me/${number}?text=${encodeURIComponent(text)}` : null;
