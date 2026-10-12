import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
  /** Cuenta ADMIN por defecto de una sucursal nueva: hay que activarla antes de usar el sistema. */
  must_change_password: boolean;
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
  // Solo se avisa "tu sesión terminó" si había una sesión en uso; un token viejo guardado se
  // descarta en silencio (por ejemplo, al abrir la portada pública).
  const hadSession = useRef(false);
  useEffect(() => { hadSession.current = me !== null; }, [me]);

  // Datos guardados en el navegador (React Query): se borran al cambiar de usuario o cerrar sesión,
  // así en una computadora compartida nadie ve por unos minutos lo que veía el anterior
  const qc = useQueryClient();

  /** Carga la sesión; devuelve false si el token no sirve. */
  const load = useCallback(async (): Promise<boolean> => {
    if (!tokenStore.get()) {
      setMe(null);
      return false;
    }
    try {
      setMe(await apiGet<MeResponse>("/api/auth/me"));
      return true;
    } catch {
      tokenStore.clear();
      setMe(null);
      return false;
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
    // La API avisa cuando la sesión venció o se cerró (contraseña nueva, rol cambiado…)
    const onLogout = async (e: Event) => {
      const wasLoggedIn = hadSession.current;
      setMe(null);
      qc.clear();
      if (!wasLoggedIn) return;
      const { toast } = await import("sonner");
      toast.error((e as CustomEvent<string>).detail || "Tu sesión terminó. Vuelve a iniciar sesión.");
    };
    window.addEventListener(LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(LOGOUT_EVENT, onLogout);
  }, [load, qc]);

  /** Cambia de sesión ("Entrar como…", volver a la propia). Lanza un error si el token no sirve. */
  const setSessionToken = useCallback(async (token: string) => {
    qc.clear();
    tokenStore.set(token);
    if (!(await load())) throw new Error("No se pudo iniciar esa sesión. Vuelve a intentarlo.");
  }, [load, qc]);

  const signIn = useCallback(async (login: string, password: string) => {
    const { token } = await apiPost<{ token: string }>("/api/auth/login", { login, password });
    await setSessionToken(token);
  }, [setSessionToken]);

  const signOut = useCallback(async () => {
    tokenStore.clear();
    tokenStore.clearAdmin();
    setMe(null);
    qc.clear();
  }, [qc]);

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
    reloadPermissions: async () => { await load(); },
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
