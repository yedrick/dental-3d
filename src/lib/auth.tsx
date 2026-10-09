import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet, apiPost, LOGOUT_EVENT, tokenStore } from "@/lib/api";

export const ROLES = ["ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"] as const;
export type AppRole = (typeof ROLES)[number];

export interface SessionUser {
  id: string;
  username: string;
  full_name: string;
  email: string;
  active: boolean;
  approved: boolean;
  created_at: string;
}

interface MeResponse {
  user: SessionUser;
  roles: AppRole[];
  permissions: string[];
  tenant: { id: string; name: string };
  impersonated_by: string | null;
}

interface AuthCtx {
  user: SessionUser | null;
  roles: AppRole[];
  permissions: Set<string>;
  tenant: { id: string; name: string } | null;
  /** ADMIN que está "iniciando sesión como" este usuario. */
  impersonatedBy: string | null;
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAny: (r: AppRole[]) => boolean;
  can: (permKey: string) => boolean;
  reloadPermissions: () => Promise<void>;
  signIn: (login: string, password: string) => Promise<void>;
  /** Reemplaza el token (cambio de contraseña, suplantación) y recarga la sesión. */
  setSessionToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!tokenStore.get()) {
      setMe(null);
      return;
    }
    try {
      setMe(await apiGet<MeResponse>("/api/auth/me"));
    } catch {
      tokenStore.clear();
      setMe(null);
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // La API avisa cuando la sesión venció o se cerró (contraseña nueva, rol cambiado…)
    const onLogout = async (e: Event) => {
      setMe(null);
      const { toast } = await import("sonner");
      toast.error((e as CustomEvent<string>).detail || "Tu sesión terminó. Vuelve a iniciar sesión.");
    };
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout);
  }, [load]);

  const setSessionToken = useCallback(async (token: string) => {
    tokenStore.set(token);
    await load();
  }, [load]);

  const signIn = useCallback(async (login: string, password: string) => {
    const { token } = await apiPost<{ token: string }>("/api/auth/login", { login, password });
    await setSessionToken(token);
  }, [setSessionToken]);

  const signOut = useCallback(async () => {
    tokenStore.clear();
    tokenStore.clearAdmin();
    setMe(null);
  }, []);

  const roles = me?.roles ?? [];
  const permissions = new Set(me?.permissions ?? []);
  const value: AuthCtx = {
    user: me?.user ?? null,
    roles,
    permissions,
    tenant: me?.tenant ?? null,
    impersonatedBy: me?.impersonated_by ?? null,
    loading,
    hasRole: (r) => roles.includes(r),
    hasAny: (rs) => rs.some((r) => roles.includes(r)),
    // La API ya devuelve todos los permisos para ADMIN
    can: (k) => permissions.has(k),
    reloadPermissions: load,
    signIn,
    setSessionToken,
    signOut,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
