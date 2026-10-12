import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { translateError } from "@/lib/translate-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Iniciar sesión · 3 Dental Imagen" },
      { name: "description", content: "Accede al sistema de gestión de 3 Dental Imagen para agendar, registrar pacientes y consultar estudios." },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Iniciar sesión · 3 Dental Imagen" },
      { property: "og:description", content: "Acceso al sistema de gestión de 3 Dental Imagen." },
      { property: "og:url", content: "https://3d.kollatek.com/auth" },
    ],
    links: [{ rel: "canonical", href: "https://3d.kollatek.com/auth" }],
  }),
  component: AuthPage,
});

type PasswordChecks = {
  len: boolean;
  upper: boolean;
  lower: boolean;
  num: boolean;
  sym: boolean;
  
};

function Req({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-primary" : "text-muted-foreground"}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      <span>{children}</span>
    </li>
  );
}

function PasswordField({
  password,
  showHelp = false,
  checks,
  onPasswordChange,
  onEnter,
}: {
  password: string;
  showHelp?: boolean;
  checks: PasswordChecks;
  onPasswordChange: (value: string) => void;
  onEnter?: () => void;
}) {
  const id = useId();
  return (
    <div>
      <Label htmlFor={id}>Contraseña</Label>
      <PasswordInput
        id={id}
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
        autoComplete={showHelp ? "new-password" : "current-password"}
        onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      />
      {showHelp && (
        <div className="mt-2 rounded-md border bg-muted/40 p-2 text-xs">
          <p className="mb-1 font-medium">Tu contraseña debe cumplir:</p>
          <ul className="space-y-1">
            <Req ok={checks.len}>Mínimo 10 caracteres</Req>
            <Req ok={checks.upper}>Al menos una MAYÚSCULA (A-Z)</Req>
            <Req ok={checks.lower}>Al menos una minúscula (a-z)</Req>
            <Req ok={checks.num}>Al menos un número (0-9)</Req>
            <Req ok={checks.sym}>Al menos un símbolo (!@#$%...)</Req>
            
          </ul>
          <p className="mt-2 text-muted-foreground">
            Inventa una contraseña nueva que NO uses en otros sitios. Ejemplo válido: <code className="rounded bg-background px-1">Dental3D#Clinica-2026!</code>
          </p>
        </div>
      )}
    </div>
  );
}

function AuthPage() {
  const { user, loading, signIn: login } = useAuth();
  const branding = useBranding();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && user) navigate({ to: "/app" }); }, [user, loading, navigate]);
  useEffect(() => {
    const err = new URLSearchParams(window.location.search).get("error");
    if (err === "impersonation") toast.error("El enlace de \"Entrar como…\" venció o ya se usó (dura 60 segundos). Genera otro desde el panel.");
    if (err === "impersonation_user") toast.error("El usuario indicado en \"Entrar como…\" no existe o está inactivo en esta sucursal.");
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);

  const checks = useMemo(() => ({
    len: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    num: /[0-9]/.test(password),
    sym: /[^A-Za-z0-9]/.test(password),
    
  }), [password]);
  const allOk = Object.values(checks).every(Boolean);

  const signIn = async () => {
    if (!email || !password) { toast.error("Ingresa tu email o usuario y la contraseña."); return; }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate({ to: "/app" });
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setBusy(false);
    }
  };
  // Pendiente: recuperar por email (necesita un servicio de correo). Mientras tanto, un ADMIN
  // asigna una contraseña nueva desde Usuarios.
  const forgotPassword = () => {
    navigate({ to: "/reset-password" });
  };
  const signUp = async () => {
    if (!allOk) { toast.error("Tu contraseña no cumple los requisitos mínimos."); return; }
    setBusy(true);
    try {
      const res = await apiPost<{ message: string }>("/api/auth/register", { email, password, username, full_name: fullName });
      toast.success(res.message, { duration: 8000 });
    } catch (e) {
      toast.error(translateError(e), { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  if (branding.loaded && branding.tenantMissing) {
    return (
      <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Elige tu sucursal</CardTitle>
            <CardDescription>
              Este sistema se usa desde la dirección de tu sucursal, por ejemplo <b>calacoto.{window.location.host}</b>.
              Pide la dirección a tu administrador.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Panel de tenancy-node: crear sucursales, tema, "Entrar como…" (solo en el dominio central) */}
            <a href="/admin/" className="text-sm text-primary underline underline-offset-2">Administración de la plataforma</a>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img src={branding.logo} alt="" className="h-8 w-8 rounded-md object-contain" />
            {branding.name}
          </CardTitle>
          <CardDescription>Sistema de gestión radiológica dental</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="in">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="in">Ingresar</TabsTrigger>
              <TabsTrigger value="up">Registrar</TabsTrigger>
            </TabsList>
            <TabsContent value="in" className="space-y-3">
              <div><Label>Email o usuario</Label><Input value={email} autoComplete="username" onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && signIn()} /></div>
              <PasswordField password={password} checks={checks} onPasswordChange={setPassword} onEnter={signIn} />
              <Button onClick={signIn} disabled={busy} className="w-full">Ingresar</Button>
              <button
                type="button"
                onClick={forgotPassword}
                disabled={busy}
                className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                ¿Olvidaste tu contraseña?
              </button>
            </TabsContent>
            <TabsContent value="up" className="space-y-3">
              <div><Label>Nombre completo</Label><Input value={fullName} onChange={(e) => setFullName(e.target.value)} /></div>
              <div><Label>Usuario</Label><Input value={username} onChange={(e) => setUsername(e.target.value)} /></div>
              <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <PasswordField password={password} showHelp checks={checks} onPasswordChange={setPassword} />
              <Button onClick={signUp} disabled={busy || !allOk} className="w-full">Crear cuenta</Button>
              <p className="text-xs text-muted-foreground">Tu cuenta quedará como RECEPCION y pendiente hasta que un administrador la apruebe.</p>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
