import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import defaultLogo from "@/assets/logo-3d.png";

// Marca de la sucursal: nombre, contacto, colores y logo, leídos sin sesión de GET /tenancy/me
// (tenancy-node). Si la sucursal no tiene logo propio se usa el logo original de la clínica.

export interface Branding {
  id: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  logo: string;
  primary: string | null;
  /** true si la página se abrió sin el subdominio de una sucursal (o la sucursal no existe). */
  tenantMissing: boolean;
  loaded: boolean;
  reload: () => Promise<void>;
}

const DEFAULT_NAME = "3 Dental Imagen";

const Ctx = createContext<Branding | null>(null);

/** Texto blanco u oscuro según qué contraste mejor con el color. */
function foregroundFor(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#0F172A" : "#FFFFFF";
}

/** Aplica el color principal de la sucursal a las variables de shadcn (solo en modo claro). */
function applyPrimary(primary: string | null) {
  const id = "tenant-theme";
  document.getElementById(id)?.remove();
  if (!primary) return;
  const style = document.createElement("style");
  style.id = id;
  const fg = foregroundFor(primary);
  style.textContent = `:root:not(.dark){--primary:${primary};--primary-foreground:${fg};--sidebar-primary:${primary};--sidebar-primary-foreground:${fg};--ring:${primary}}`;
  document.head.appendChild(style);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Branding, "reload">>({
    id: null, name: DEFAULT_NAME, address: null, phone: null, logo: defaultLogo, primary: null, tenantMissing: false, loaded: false,
  });

  const load = async () => {
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL as string | undefined) ?? ""}/tenancy/me`, { cache: "no-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const me = (await res.json()) as { id: string; name?: string; address?: string; phone?: string; theme?: { primary?: string; logo?: string } };
      setState({
        id: me.id,
        name: me.name || DEFAULT_NAME,
        address: me.address ?? null,
        phone: me.phone ?? null,
        logo: me.theme?.logo || defaultLogo,
        primary: me.theme?.primary ?? null,
        tenantMissing: false,
        loaded: true,
      });
      applyPrimary(me.theme?.primary ?? null);
    } catch {
      setState((s) => ({ ...s, tenantMissing: true, loaded: true }));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return <Ctx.Provider value={{ ...state, reload: load }}>{children}</Ctx.Provider>;
}

export function useBranding() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBranding must be inside BrandingProvider");
  return c;
}
