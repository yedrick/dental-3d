import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Eye, EyeOff, Pencil, Trash2, UserPlus, Search, ShieldCheck, LogIn, CheckCircle2, XCircle } from "lucide-react";
import { useAuth, type AppRole } from "@/lib/auth";
import { adminCreateUser, adminUpdateUser, adminDeleteUser, adminImpersonate } from "@/lib/users-admin.functions";

const ROLES: AppRole[] = ["ADMIN", "SUBADMIN", "RECEPCION", "CAJA", "CONTABILIDAD", "DOCTOR", "AUDITOR"];

const ROLE_STYLES: Record<AppRole, string> = {
  ADMIN: "bg-primary/15 text-primary border-primary/30",
  SUBADMIN: "bg-indigo-500/15 text-indigo-600 border-indigo-500/30",
  RECEPCION: "bg-blue-500/15 text-blue-600 border-blue-500/30",
  CAJA: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  CONTABILIDAD: "bg-amber-500/15 text-amber-700 border-amber-500/30",
  DOCTOR: "bg-purple-500/15 text-purple-600 border-purple-500/30",
  AUDITOR: "bg-slate-500/15 text-slate-600 border-slate-500/30",
};

export const Route = createFileRoute("/app/users")({ component: UsersPage });

type Row = {
  id: string;
  email: string;
  full_name: string;
  username: string;
  created_at: string;
  role: AppRole | null;
};

function UsersPage() {
  const { user, hasRole } = useAuth();
  const isAdmin = hasRole("ADMIN");
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const impersonateFn = useServerFn(adminImpersonate);

  const impersonate = async (u: Row) => {
    if (!confirm(`¿Ingresar como ${u.full_name} (${u.email})?\n\nTu sesión actual se guardará para poder volver.`)) return;
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.refresh_token) {
        sessionStorage.setItem("impersonation_return", JSON.stringify({
          refresh_token: sess.session.refresh_token,
          admin_email: user?.email,
        }));
      }
      const { token_hash } = await impersonateFn({ data: { user_id: u.id } });
      const { error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });
      if (error) throw error;
      toast.success(`Ahora eres ${u.full_name}`);
      window.location.href = "/app";
    } catch (e: any) {
      sessionStorage.removeItem("impersonation_return");
      toast.error(e.message ?? "No se pudo cambiar de usuario");
    }
  };


  const { data = [], isLoading } = useQuery({
    queryKey: ["users_admin"],
    queryFn: async (): Promise<Row[]> => {
      const [{ data: profiles }, { data: roles }] = await Promise.all([
        supabase.from("profiles").select("*").order("created_at", { ascending: false }),
        supabase.from("user_roles").select("*"),
      ]);
      const roleByUser = new Map<string, AppRole>();
      (roles ?? []).forEach((r: any) => roleByUser.set(r.user_id, r.role));
      return (profiles ?? []).map((p: any) => ({ ...p, role: roleByUser.get(p.id) ?? null }));
    },
  });

  const filtered = data.filter((u) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(s) ||
      u.email?.toLowerCase().includes(s) ||
      u.username?.toLowerCase().includes(s) ||
      u.role?.toLowerCase().includes(s)
    );
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["users_admin"] });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Usuarios y roles"
        description="Crea, edita y administra los accesos al sistema. Solo ADMIN."
      />

      <Card className="p-4 flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por nombre, email, usuario o rol…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" />{data.length} usuarios</Badge>
          {isAdmin && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button><UserPlus className="h-4 w-4 mr-2" />Nuevo usuario</Button>
              </DialogTrigger>
              <UserFormDialog
                mode="create"
                onDone={() => { setCreateOpen(false); refresh(); }}
              />
            </Dialog>
          )}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground py-8 text-center">Cargando…</TableCell></TableRow>
            )}
            {!isLoading && filtered.map((u) => (
              <TableRow key={u.id} className="hover:bg-muted/40">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold">
                      {(u.full_name || u.email || "?").slice(0, 1).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{u.full_name}{u.id === user?.id && <span className="ml-2 text-xs text-muted-foreground">(tú)</span>}</div>
                      <div className="text-xs text-muted-foreground">@{u.username}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-sm">{u.email}</TableCell>
                <TableCell>
                  {u.role ? (
                    <Badge variant="outline" className={ROLE_STYLES[u.role]}>{u.role}</Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Sin rol</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {isAdmin && (
                    <div className="flex justify-end gap-1">
                      {u.id !== user?.id && (
                        <Button size="sm" variant="ghost" title="Ingresar como este usuario" onClick={() => impersonate(u)}>
                          <LogIn className="h-4 w-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={u.id === user?.id}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>¿Eliminar usuario?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Se eliminará <b>{u.full_name}</b> ({u.email}) de forma permanente.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancelar</AlertDialogCancel>
                            <AlertDialogAction
                              className="bg-destructive hover:bg-destructive/90"
                              onClick={async () => {
                                try {
                                  await adminDeleteUser({ data: { user_id: u.id } });
                                  toast.success("Usuario eliminado");
                                  refresh();
                                } catch (e: any) { toast.error(e.message); }
                              }}
                            >Eliminar</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-muted-foreground py-8 text-center">Sin resultados.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {editing && (
        <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
          <UserFormDialog
            mode="edit"
            initial={editing}
            onDone={() => { setEditing(null); refresh(); }}
          />
        </Dialog>
      )}
    </div>
  );
}

function UserFormDialog({
  mode,
  initial,
  onDone,
}: {
  mode: "create" | "edit";
  initial?: Row;
  onDone: () => void;
}) {
  const create = useServerFn(adminCreateUser);
  const update = useServerFn(adminUpdateUser);
  const [full_name, setFullName] = useState(initial?.full_name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<AppRole>(initial?.role ?? "RECEPCION");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      if (mode === "create") {
        if (password.length < 8) throw new Error("La contraseña debe tener al menos 8 caracteres");
        await create({ data: { email, password, full_name, username, role } });
        toast.success("Usuario creado");
      } else {
        await update({
          data: {
            user_id: initial!.id,
            email: email !== initial!.email ? email : undefined,
            password: password || undefined,
            full_name,
            username,
            role,
          },
        });
        toast.success("Usuario actualizado");
      }
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{mode === "create" ? "Nuevo usuario" : "Editar usuario"}</DialogTitle>
        <DialogDescription>
          {mode === "create"
            ? "Se creará con acceso inmediato."
            : "Deja la contraseña vacía para no cambiarla."}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Nombre completo</Label>
            <Input value={full_name} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label>Usuario</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} />
          </div>
        </div>
        <div>
          <Label>Email</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label>{mode === "create" ? "Contraseña" : "Nueva contraseña (opcional)"}</Label>
          <div className="relative">
            <Input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === "edit" ? "Dejar vacío para no cambiar" : "Mínimo 8 caracteres"}
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label>Rol</Label>
          <Select value={role} onValueChange={(v) => setRole(v as AppRole)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button onClick={submit} disabled={saving || !full_name || !email || !username}>
          {saving ? "Guardando…" : mode === "create" ? "Crear usuario" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
