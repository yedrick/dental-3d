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
  /** Plan de la sucursal (tenancy-node 0.11, ver server/src/tenancy/plans.ts). */
  plan: string | null;
  planLabel: string | null;
  /** Módulos del plan. null = sin control de planes (todo habilitado). */
  features: string[] | null;
  limits: Record<string, number | null>;
  /** true si el plan incluye el módulo (o si no hay planes). */
  hasFeature: (feature: string) => boolean;
  /** true en el dominio principal de IONIX (sin subdominio de sucursal): web comercial. */
  central: boolean;
  /** true si la página se abrió sin el subdominio de una sucursal (o la sucursal no existe). */
  tenantMissing: boolean;
  loaded: boolean;
  reload: () => Promise<void>;
}

const DEFAULT_NAME = "IONIX";

const Ctx = createContext<Branding | null>(null);

/** Texto blanco u oscuro según qué contraste mejor con el color. */
function foregroundFor(hex: string) {
  const h = hex.replace("#", "");
  const full = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? "#0F172A" : "#FFFFFF";
}

/** Tema que se edita en el panel de la plataforma (Sucursales → Tema). */
export interface TenantTheme {
  primary?: string;
  background?: string;
  text?: string;
  font?: string;
  radius?: "none" | "sm" | "md" | "lg";
  logo?: string;
  favicon?: string;
}

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const hex = (v?: string) => (v && HEX.test(v) ? v : null);

const RADIUS: Record<string, string> = { none: "0rem", sm: "0.25rem", md: "0.625rem", lg: "1rem" };

/** Fuentes del sistema: no hace falta descargarlas. */
const SYSTEM_FONTS: Record<string, string> = {
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Geneva, sans-serif",
  "trebuchet ms": "'Trebuchet MS', sans-serif",
  georgia: "Georgia, serif",
  "times new roman": "'Times New Roman', Times, serif",
  "courier new": "'Courier New', monospace",
};

/**
 * Nombre de fuente seguro para CSS (sin comillas ni símbolos). El panel solo deja elegir las fuentes
 * de theme.fonts (server/src/tenancy/config.ts): las que no son del sistema son de Google Fonts.
 */
function fontName(raw?: string) {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v || v.length > 40 || !/^[A-Za-z0-9 -]+$/.test(v)) return null;
  return v;
}

function loadGoogleFont(name: string) {
  const id = "tenant-font";
  const href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  const prev = document.getElementById(id) as HTMLLinkElement | null;
  if (prev?.href === href) return;
  prev?.remove();
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

/**
 * Aplica el tema de la sucursal a las variables de shadcn: colores solo en modo claro,
 * tipografía y bordes en los dos modos. Lo que no está definido queda como el diseño original.
 */
function applyTheme(theme: TenantTheme | undefined) {
  const id = "tenant-theme";
  document.getElementById(id)?.remove();
  const primary = hex(theme?.primary);
  const background = hex(theme?.background);
  const text = hex(theme?.text);
  const light: string[] = [];
  if (primary) {
    const fg = foregroundFor(primary);
    light.push(`--primary:${primary}`, `--primary-foreground:${fg}`, `--sidebar-primary:${primary}`, `--sidebar-primary-foreground:${fg}`, `--ring:${primary}`);
  }
  if (background) light.push(`--background:${background}`);
  if (text) light.push(`--foreground:${text}`, `--card-foreground:${text}`, `--popover-foreground:${text}`);

  const both: string[] = [];
  const radius = theme?.radius ? RADIUS[theme.radius] : undefined;
  if (radius) both.push(`--radius:${radius}`);
  const font = fontName(theme?.font);
  if (font) {
    const system = SYSTEM_FONTS[font.toLowerCase()];
    if (!system) loadGoogleFont(font);
    const stack = system ?? `'${font}', ui-sans-serif, system-ui, sans-serif`;
    both.push(`--font-sans:${stack}`, `--default-font-family:${stack}`);
  } else {
    document.getElementById("tenant-font")?.remove();
  }

  const favicon = theme?.favicon;
  if (favicon) {
    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.head.appendChild(Object.assign(document.createElement("link"), { rel: "icon" }));
    icon.href = favicon;
  }

  if (!light.length && !both.length) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent =
    (light.length ? `:root:not(.dark){${light.join(";")}}` : "") +
    (both.length ? `:root{${both.join(";")}}` : "") +
    (font ? "body{font-family:var(--font-sans)}" : "");
  document.head.appendChild(style);
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Branding, "reload" | "hasFeature">>({
    id: null, name: DEFAULT_NAME, address: null, phone: null, logo: defaultLogo, primary: null,
    plan: null, planLabel: null, features: null, limits: {}, central: false, tenantMissing: false, loaded: false,
  });

  const load = async () => {
    try {
      const res = await fetch(`${(import.meta.env.VITE_API_URL as string | undefined) ?? ""}/tenancy/me`, { cache: "no-cache" });
      if (!res.ok) {
        // Dominio principal: TENANCY_TENANT_NOT_IDENTIFIED. Subdominio que no existe: TENANCY_TENANT_NOT_FOUND
        const code = ((await res.json().catch(() => null)) as { error?: { code?: string } } | null)?.error?.code;
        setState((s) => ({ ...s, central: code === "TENANCY_TENANT_NOT_IDENTIFIED", tenantMissing: true, loaded: true }));
        return;
      }
      const me = (await res.json()) as {
        id: string; name?: string; address?: string; phone?: string; theme?: TenantTheme;
        plan?: string | null; planLabel?: string | null; features?: string[]; limits?: Record<string, number | null>;
      };
      setState({
        id: me.id,
        name: me.name || DEFAULT_NAME,
        address: me.address ?? null,
        phone: me.phone ?? null,
        logo: me.theme?.logo || defaultLogo,
        primary: me.theme?.primary ?? null,
        plan: me.plan ?? null,
        planLabel: me.planLabel ?? null,
        features: Array.isArray(me.features) ? me.features : null,
        limits: me.limits ?? {},
        central: false,
        tenantMissing: false,
        loaded: true,
      });
      applyTheme(me.theme);
    } catch {
      setState((s) => ({ ...s, tenantMissing: true, loaded: true }));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const hasFeature = (feature: string) => state.features === null || state.features.includes(feature);
  return <Ctx.Provider value={{ ...state, hasFeature, reload: load }}>{children}</Ctx.Provider>;
}

export function useBranding() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useBranding must be inside BrandingProvider");
  return c;
}
