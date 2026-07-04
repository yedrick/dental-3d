import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const ROLES = ["ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"] as const;
type Role = (typeof ROLES)[number];

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "ADMIN" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Solo ADMIN puede realizar esta acción");
}

export const adminCreateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      email: z.string().email(),
      password: z.string().min(8),
      full_name: z.string().min(1),
      username: z.string().min(1),
      role: z.enum(ROLES),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.full_name, username: data.username },
    });
    if (error) throw new Error(error.message);
    const uid = created.user!.id;
    // handle_new_user trigger inserts default role; replace with chosen role
    await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
    const { error: rErr } = await supabaseAdmin.from("user_roles").insert({ user_id: uid, role: data.role });
    if (rErr) throw new Error(rErr.message);
    // Admin-created users are auto-approved
    await supabaseAdmin.from("profiles").update({ approved: true }).eq("id", uid);
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "USER_CREATE",
      table_name: "auth.users",
      record_id: uid,
      data: { email: data.email, full_name: data.full_name, username: data.username, role: data.role },
    });
    return { id: uid };
  });

export const adminUpdateUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({
      user_id: z.string().uuid(),
      email: z.string().email().optional(),
      password: z.string().min(8).optional().or(z.literal("")),
      full_name: z.string().min(1).optional(),
      username: z.string().min(1).optional(),
      role: z.enum(ROLES).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const changed: Record<string, any> = {};
    const authPatch: any = {};
    if (data.email) authPatch.email = data.email;
    if (data.password && data.password.length > 0) authPatch.password = data.password;
    if (Object.keys(authPatch).length) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, authPatch);
      if (error) throw new Error(error.message);
      if (data.email) changed.email = data.email;
      if (data.password) changed.password_changed = true;
    }
    const profPatch: any = {};
    if (data.full_name !== undefined) profPatch.full_name = data.full_name;
    if (data.username !== undefined) profPatch.username = data.username;
    if (data.email) profPatch.email = data.email;
    if (Object.keys(profPatch).length) {
      const { error } = await supabaseAdmin.from("profiles").update(profPatch).eq("id", data.user_id);
      if (error) throw new Error(error.message);
      Object.assign(changed, profPatch);
    }
    if (data.role) {
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
      const { error } = await supabaseAdmin.from("user_roles").insert({ user_id: data.user_id, role: data.role });
      if (error) throw new Error(error.message);
      changed.role = data.role;
    }
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "USER_UPDATE",
      table_name: "auth.users",
      record_id: data.user_id,
      data: { changed },
    });
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("No puedes eliminar tu propio usuario");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles").select("email, full_name, username").eq("id", data.user_id).maybeSingle();
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      const detail = (error as any).message || (error as any).code || JSON.stringify(error);
      const isFk = /foreign key|violates|referenced/i.test(detail);
      throw new Error(
        isFk
          ? "No se puede eliminar: el usuario tiene registros asociados (auditoría, pacientes, etc.). Considera desactivarlo en su lugar."
          : `Error al eliminar usuario: ${detail}`,
      );
    }
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "USER_DELETE",
      table_name: "auth.users",
      record_id: data.user_id,
      data: { profile: prof ?? null },
    });
    return { ok: true };
  });

export const adminImpersonate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ user_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) throw new Error("Ya eres este usuario");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof, error: pErr } = await supabaseAdmin
      .from("profiles").select("email, full_name").eq("id", data.user_id).maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!prof?.email) throw new Error("Usuario sin email");
    const { data: link, error } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: prof.email,
    });
    if (error) throw new Error(error.message);
    const token_hash = (link as any)?.properties?.hashed_token;
    if (!token_hash) throw new Error("No se pudo generar el enlace de acceso");
    await supabaseAdmin.from("audit_logs").insert({
      user_id: context.userId,
      action: "USER_UPDATE",
      table_name: "auth.users",
      record_id: data.user_id,
      data: { impersonate: true, target: prof.email },
    });
    return { token_hash, email: prof.email, full_name: prof.full_name };
  });

