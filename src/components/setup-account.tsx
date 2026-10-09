import { useState } from "react";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { translateError } from "@/lib/translate-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Activación de la cuenta ADMIN por defecto de una sucursal nueva (creada por el seed de
 * tenancy-node). Se llega con "Entrar como…" desde el panel de la plataforma; hasta completar
 * este formulario no se puede usar el sistema.
 */
export function SetupAccount() {
  const { user, setSessionToken, signOut } = useAuth();
  const branding = useBranding();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState(user?.username ?? "admin");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  const strong = pw.length >= 10 && /[A-Z]/.test(pw) && /[a-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);

  const save = async () => {
    if (!fullName.trim() || !username.trim() || !email.trim()) return toast.error("Completa nombre, usuario y email");
    if (!strong) return toast.error("La contraseña debe tener 10+ caracteres, mayúscula, minúscula, número y símbolo");
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    setBusy(true);
    try {
      const { token } = await apiPost<{ token: string }>("/api/auth/setup-account", {
        full_name: fullName.trim(), username: username.trim(), email: email.trim(), new_password: pw,
      });
      await setSessionToken(token);
      toast.success("Cuenta activada. Ya puedes usar el sistema con tu usuario y contraseña.");
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img src={branding.logo} alt="" className="h-8 w-8 rounded-md object-contain" />
            Activa la cuenta de administrador
          </CardTitle>
          <CardDescription>
            Esta es la cuenta ADMIN que se creó con la sucursal <b>{branding.name}</b>. Define sus datos y su
            contraseña: con ellos se ingresará desde <b>{window.location.host}</b>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2"><Label>Nombre completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Usuario</Label><Input value={username} autoComplete="username" onChange={(e) => setUsername(e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label>Contraseña</Label><Input type="password" value={pw} autoComplete="new-password" onChange={(e) => setPw(e.target.value)} /></div>
          <div className="space-y-1"><Label>Repetir contraseña</Label><Input type="password" value={pw2} autoComplete="new-password" onChange={(e) => setPw2(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground sm:col-span-2">Mínimo 10 caracteres, con mayúscula, minúscula, número y símbolo.</p>
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Activar cuenta</Button>
            <Button variant="ghost" onClick={() => signOut()}>Salir</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
