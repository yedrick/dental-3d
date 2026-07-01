import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Session, User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

interface AuthCtx {
  user: User | null;
  session: Session | null;
  roles: AppRole[];
  permissions: Set<string>;
  loading: boolean;
  hasRole: (r: AppRole) => boolean;
  hasAny: (r: AppRole[]) => boolean;
  can: (permKey: string) => boolean;
  reloadPermissions: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

async function loadPermissionsFor(roles: AppRole[]): Promise<Set<string>> {
  if (roles.length === 0) return new Set();
  const { data } = await supabase.from("role_permissions").select("permission_key").in("role", roles);
  return new Set((data ?? []).map((r: any) => r.permission_key as string));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [roles, setRoles] = useState<AppRole[]>([]);
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const loadRolesAndPerms = async (userId: string) => {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const rs = (data ?? []).map((r: any) => r.role as AppRole);
    setRoles(rs);
    setPermissions(await loadPermissionsFor(rs));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => { loadRolesAndPerms(s.user.id); }, 0);
      } else {
        setRoles([]); setPermissions(new Set());
      }
    });
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session?.user) await loadRolesAndPerms(data.session.user.id);
      setLoading(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthCtx = {
    user: session?.user ?? null,
    session,
    roles,
    permissions,
    loading,
    hasRole: (r) => roles.includes(r),
    hasAny: (rs) => rs.some((r) => roles.includes(r)),
    can: (k) => roles.includes("ADMIN") || permissions.has(k),
    reloadPermissions: async () => { if (session?.user) await loadRolesAndPerms(session.user.id); },
    signOut: async () => { await supabase.auth.signOut(); },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be inside AuthProvider");
  return c;
}
