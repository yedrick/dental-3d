import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { apiDelete, apiGet, apiPatch, apiPost, apiPut, tokenStore } from "@/lib/api";
import { formatDate } from "@/lib/data";
import { STALE } from "@/lib/query-config";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Pencil, Trash2, UserPlus, Search, ShieldCheck, LogIn, CheckCircle2, XCircle } from "lucide-react";
import { useAuth, ROLES, type AppRole } from "@/lib/auth";
import { TableSkeletonRows } from "@/components/table-skeleton";

/** Reglas de la API: ≥10 caracteres, mayúscula, minúscula, número y símbolo. */
function passwordProblem(pw: string): string | null {
  if (pw.length < 10) return "La contraseña debe tener al menos 10 caracteres";
  if (!/[A-Z]/.test(pw)) return "La contraseña debe tener una mayúscula";
  if (!/[a-z]/.test(pw)) return "La contraseña debe tener una minúscula";
  if (!/[0-9]/.test(pw)) return "La contraseña debe tener un número";
  if (!/[^A-Za-z0-9]/.test(pw)) return "La contraseña debe tener un símbolo";
  return null;
}

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
  approved: boolean;
  active: boolean;
  roles: AppRole[];
  /** Ficha de doctor enlazada (usuarios DOCTOR) */
  doctor_id?: string | null;
};

function UsersPage() {
  const { user, can, setSessionToken } = useAuth();
  // Los permisos los controla la API; aquí solo se ocultan los botones
  const canCreate = can("users.create");
  const canEdit = can("users.edit") || can("users.manage_roles");
  const canDelete = can("users.delete");
  const canApprove = can("users.approve");
  const canImpersonate = can("users.impersonate");
  const qc = useQueryClient();

  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);

  const impersonate = async (u: Row) => {
    if (!confirm(`¿Ingresar como ${u.full_name} (${u.email})?\n\nTu sesión actual se guardará para poder volver.`)) return;
    try {
      const res = await apiPost<{ token: string; user: { full_name: string }; expires_in: number }>(`/api/users/${u.id}/impersonate`);
      // Se guarda el token del ADMIN para "Volver a mi sesión"
      tokenStore.setAdmin(tokenStore.get()!);
      await setSessionToken(res.token);
      toast.success(`Ahora eres ${u.full_name}`);
      window.location.href = "/app";
    } catch (e) {
      toast.error(translateError(e) || "No se pudo cambiar de usuario");
    }
  };

  const toggleApproved = async (u: Row) => {
    const next = !u.approved;
    try {
      await apiPost(`/api/users/${u.id}/approve`, { approved: next });
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success(next ? `${u.full_name} aprobado — ya puede iniciar sesión` : `${u.full_name} deshabilitado`);
    refresh();
  };




  const { data = [], isLoading } = useQuery({
    queryKey: ["users_admin"],
    queryFn: () => apiGet<Row[]>("/api/users"),
    staleTime: STALE.master,
  });

  const filtered = data.filter((u) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return (
      u.full_name?.toLowerCase().includes(s) ||
      u.email?.toLowerCase().includes(s) ||
      u.username?.toLowerCase().includes(s) ||
      u.roles.some((r) => r.toLowerCase().includes(s))
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
            aria-label="Buscar usuarios"
            placeholder="Buscar por nombre, email, usuario o rol…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="gap-1"><ShieldCheck className="h-3 w-3" />{data.length} usuarios</Badge>
          {canCreate && (
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
              <TableHead>Estado</TableHead>
              <TableHead>Creado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableSkeletonRows cols={6} />}
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
                  {u.roles.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => <Badge key={r} variant="outline" className={ROLE_STYLES[r]}>{r}</Badge>)}
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">Sin rol</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {u.approved ? (
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Aprobado
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/15 text-amber-700 border-amber-500/30 gap-1">
                      <XCircle className="h-3 w-3" /> Pendiente
                    </Badge>
                  )}
                  {!u.active && (
                    <Badge variant="outline" className="ml-1 text-muted-foreground">Inactivo</Badge>
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDate(u.created_at)}
                </TableCell>
                <TableCell className="text-right">
                  {(canApprove || canEdit || canDelete || canImpersonate) && (
                    <div className="flex justify-end gap-1">
                      {canApprove && u.id !== user?.id && (
                        <Button
                          size="sm"
                          variant={u.approved ? "ghost" : "default"}
                          title={u.approved ? "Deshabilitar acceso" : "Aprobar acceso"}
                          aria-label={`${u.approved ? "Deshabilitar acceso de" : "Aprobar acceso de"} ${u.full_name}`}
                          onClick={() => toggleApproved(u)}
                        >
                          {u.approved ? <XCircle className="h-4 w-4" /> : <><CheckCircle2 className="h-4 w-4 mr-1" />Aprobar</>}
                        </Button>
                      )}
                      {canImpersonate && u.id !== user?.id && (
                        <Button size="sm" variant="ghost" title="Ingresar como este usuario" aria-label={`Ingresar como ${u.full_name}`} onClick={() => impersonate(u)}>
                          <LogIn className="h-4 w-4" />
                        </Button>
                      )}
                      {canEdit && (
                        <Button size="sm" variant="ghost" title="Editar" aria-label={`Editar a ${u.full_name}`} onClick={() => setEditing(u)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      )}
                      {canDelete && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={u.id === user?.id} title="Eliminar" aria-label={`Eliminar a ${u.full_name}`}>
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
                                  await apiDelete(`/api/users/${u.id}`);
                                  toast.success("Usuario eliminado");
                                  refresh();
                                } catch (e) { toast.error(translateError(e)); }
                              }}
                            >Eliminar</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      )}
                    </div>
                  )}

                </TableCell>
              </TableRow>
            ))}
            {!isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-muted-foreground py-8 text-center">Sin resultados.</TableCell></TableRow>
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
  const { can } = useAuth();
  // En edición: los datos requieren users.edit y los roles users.manage_roles
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const canEditData = mode === "create" || can("users.edit");
  const canEditRoles = mode === "create" || can("users.manage_roles");
  const [full_name, setFullName] = useState(initial?.full_name ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<AppRole[]>(initial?.roles.length ? initial.roles : ["RECEPCION"]);
  const [active, setActive] = useState(initial?.active ?? true);
  // Usuario DOCTOR: su ficha de doctor (ve solo sus pacientes, atenciones y comisiones)
  const [doctorId, setDoctorId] = useState<string>(initial?.doctor_id ?? "");
  const { data: doctors = [] } = useQuery({
    queryKey: ["doctors"],
    queryFn: () => apiGet<{ id: string; full_name: string; status: boolean }[]>("/api/doctors"),
    staleTime: STALE.master,
    enabled: roles.includes("DOCTOR"),
  });
  const toggleRole = (r: AppRole, on: boolean) =>
    setRoles((prev) => (on ? [...prev, r] : prev.filter((x) => x !== r)));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      if (roles.length === 0) throw new Error("Asigna al menos un rol");
      if (password) {
        const problem = passwordProblem(password);
        if (problem) throw new Error(problem);
      }
      if (mode === "create") {
        if (!password) throw new Error("La contraseña es requerida");
        await apiPost("/api/users", { email, username, full_name, password, roles, doctor_id: doctorId || null });
        toast.success("Usuario creado");
      } else {
        const u = initial!;
        // Solo se envían los campos que cambiaron
        const changes: Record<string, unknown> = {};
        if (canEditData) {
          if (email !== u.email) changes.email = email;
          if (username !== u.username) changes.username = username;
          if (full_name !== u.full_name) changes.full_name = full_name;
          if (password) changes.password = password;
          if (active !== u.active) changes.active = active;
          if ((doctorId || null) !== (u.doctor_id ?? null)) changes.doctor_id = doctorId || null;
        }
        const rolesChanged =
          canEditRoles && (roles.length !== u.roles.length || roles.some((r) => !u.roles.includes(r)));
        if (Object.keys(changes).length > 0) await apiPatch(`/api/users/${u.id}`, changes);
        if (rolesChanged) await apiPut(`/api/users/${u.id}/roles`, { roles });
        toast.success("Usuario actualizado");
      }
      onDone();
    } catch (e) {
      toast.error(translateError(e));
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
            <Label htmlFor={`${uid}-name`}>Nombre completo</Label>
            <Input id={`${uid}-name`} value={full_name} disabled={!canEditData} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor={`${uid}-user`}>Usuario</Label>
            <Input id={`${uid}-user`} value={username} disabled={!canEditData} onChange={(e) => setUsername(e.target.value)} />
          </div>
        </div>
        <div>
          <Label htmlFor={`${uid}-email`}>Email</Label>
          <Input id={`${uid}-email`} type="email" value={email} disabled={!canEditData} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${uid}-pw`}>{mode === "create" ? "Contraseña" : "Nueva contraseña (opcional)"}</Label>
          <PasswordInput
            id={`${uid}-pw`}
            autoComplete="new-password"
            value={password}
            disabled={!canEditData}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "edit" ? "Dejar vacío para no cambiar" : "Mín. 10: mayúscula, minúscula, número y símbolo"}
          />
        </div>
        <div>
          <Label id={`${uid}-roles`}>Roles</Label>
          <div role="group" aria-labelledby={`${uid}-roles`} className="mt-1 grid grid-cols-2 gap-2 rounded-md border p-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={roles.includes(r)}
                  disabled={!canEditRoles}
                  onCheckedChange={(v) => toggleRole(r, !!v)}
                />
                {r}
              </label>
            ))}
          </div>
        </div>
        {roles.includes("DOCTOR") && (
          <div>
            <Label htmlFor={`${uid}-doctor`}>Ficha de doctor</Label>
            <Select value={doctorId || "none"} onValueChange={(v) => setDoctorId(v === "none" ? "" : v)} disabled={!canEditData}>
              <SelectTrigger id={`${uid}-doctor`}><SelectValue placeholder="Sin enlazar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin enlazar</SelectItem>
                {doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Con el rol DOCTOR, este usuario ve solo los pacientes, atenciones y comisiones de esta ficha. Sin ficha no ve ninguno.
            </p>
          </div>
        )}
        {mode === "edit" && (
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={active} disabled={!canEditData} onCheckedChange={(v) => setActive(!!v)} />
            Usuario activo
          </label>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancelar</Button>
        <Button onClick={submit} disabled={saving || !full_name || !email || !username || roles.length === 0}>
          {saving ? "Guardando…" : mode === "create" ? "Crear usuario" : "Guardar cambios"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
