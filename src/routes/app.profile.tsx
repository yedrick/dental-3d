import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { useAuth } from "@/lib/auth";
import { apiPatch, apiPost } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, User as UserIcon, KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const { user, roles, setSessionToken, reloadPermissions } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const [currentPw, setCurrentPw] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    setFullName(user.full_name ?? "");
    setUsername(user.username ?? "");
    setEmail(user.email ?? "");
    setLoading(false);
  }, [user?.id]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      await apiPatch("/api/auth/me", { full_name: fullName, username });
      await reloadPermissions();
      toast.success("Perfil actualizado");
    } catch (e: any) {
      toast.error(translateError(e) || "Error al guardar");
    } finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (!currentPw) return toast.error("Ingresa tu contraseña actual");
    if (pw.length < 10) return toast.error("La contraseña debe tener al menos 10 caracteres, mayúscula, minúscula, número y símbolo");
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    setSavingPw(true);
    try {
      // La API cierra tus otras sesiones y devuelve un token nuevo para esta
      const { token } = await apiPost<{ token: string }>("/api/auth/change-password", { current_password: currentPw, new_password: pw });
      await setSessionToken(token);
      setCurrentPw(""); setPw(""); setPw2("");
      toast.success("Contraseña actualizada. Se cerraron tus sesiones en otros dispositivos.");
    } catch (e: any) {
      toast.error(translateError(e) || "Error al cambiar contraseña");
    } finally { setSavingPw(false); }
  };

  if (loading) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">Actualiza tu información personal y contraseña</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><UserIcon className="h-4 w-4" /> Información personal</CardTitle>
          <CardDescription>
            <span className="inline-flex flex-wrap gap-1 mt-1">
              {roles.map(r => <Badge key={r} variant="secondary">{r}</Badge>)}
            </span>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-name`}>Nombre completo</Label>
            <Input id={`${uid}-name`} value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-user`}>Usuario</Label>
            <Input id={`${uid}-user`} value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor={`${uid}-email`}>Correo</Label>
            <Input id={`${uid}-email`} value={email} disabled />
            <p className="text-xs text-muted-foreground">Para cambiar el correo contacta a un administrador.</p>
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={saveProfile} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar cambios
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><KeyRound className="h-4 w-4" /> Cambiar contraseña</CardTitle>
          <CardDescription>Mínimo 10 caracteres, con mayúscula, minúscula, número y símbolo. Se cerrarán tus sesiones en otros dispositivos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${uid}-curpw`}>Contraseña actual</Label>
            <PasswordInput id={`${uid}-curpw`} value={currentPw} autoComplete="current-password" onChange={e => setCurrentPw(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-pw`}>Nueva contraseña</Label>
            <PasswordInput id={`${uid}-pw`} value={pw} autoComplete="new-password" onChange={e => setPw(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${uid}-pw2`}>Confirmar contraseña</Label>
            <PasswordInput id={`${uid}-pw2`} value={pw2} autoComplete="new-password" onChange={e => setPw2(e.target.value)} />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <Button onClick={changePassword} disabled={savingPw || !pw}>
              {savingPw && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Cambiar contraseña
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
