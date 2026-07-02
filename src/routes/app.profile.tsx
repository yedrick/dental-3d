import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Loader2, User as UserIcon, KeyRound } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/profile")({
  component: ProfilePage,
});

function ProfilePage() {
  const { user, roles } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");

  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      setFullName(data?.full_name ?? "");
      setUsername(data?.username ?? "");
      setEmail(data?.email ?? user.email ?? "");
      setLoading(false);
    })();
  }, [user?.id]);

  const saveProfile = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("profiles").update({
        full_name: fullName, username,
      }).eq("id", user.id);
      if (error) throw error;
      toast.success("Perfil actualizado");
    } catch (e: any) {
      toast.error(e.message ?? "Error al guardar");
    } finally { setSaving(false); }
  };

  const changePassword = async () => {
    if (pw.length < 8) return toast.error("La contraseña debe tener al menos 8 caracteres");
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    setSavingPw(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw });
      if (error) throw error;
      setPw(""); setPw2("");
      toast.success("Contraseña actualizada");
    } catch (e: any) {
      toast.error(e.message ?? "Error al cambiar contraseña");
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
            <Label>Nombre completo</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Usuario</Label>
            <Input value={username} onChange={e => setUsername(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Correo</Label>
            <Input value={email} disabled />
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
          <CardDescription>Mínimo 8 caracteres</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Nueva contraseña</Label>
            <div className="relative">
              <Input type={showPw ? "text" : "password"} value={pw} onChange={e => setPw(e.target.value)} />
              <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Confirmar contraseña</Label>
            <Input type={showPw ? "text" : "password"} value={pw2} onChange={e => setPw2(e.target.value)} />
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
