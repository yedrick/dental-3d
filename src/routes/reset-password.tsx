import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { translateError } from "@/lib/translate-error";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recuperar contraseña · IONIX" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

const RESEND_SECONDS = 60;

function Req({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-primary" : "text-muted-foreground"}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      <span>{children}</span>
    </li>
  );
}

/**
 * "¿Olvidaste tu contraseña?" con un código de 6 dígitos por correo (si está activado en el .env de
 * la API). Si no, se pide la contraseña nueva a un administrador de la sucursal.
 */
function ResetPasswordPage() {
  const branding = useBranding();
  const { setSessionToken } = useAuth();
  const navigate = useNavigate();
  const ids = useId();
  const { data: status, isLoading } = useQuery({
    queryKey: ["password-reset-status"],
    queryFn: () => apiGet<{ enabled: boolean; minutes: number }>("/api/auth/password-reset"),
    staleTime: 5 * 60_000,
  });

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState(() =>
    typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("email") ?? "",
  );
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const checks = {
    len: pw.length >= 10,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    num: /[0-9]/.test(pw),
    sym: /[^A-Za-z0-9]/.test(pw),
  };

  const sendCode = async () => {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return toast.error("Escribe tu email");
    try {
      await apiPost("/api/auth/forgot-password", { email: email.trim() });
    } catch (e) {
      return toast.error(translateError(e));
    }
    setStep("code");
    setWait(RESEND_SECONDS);
    toast.success("Si el email está registrado, te enviamos un código. Revisa también la carpeta de spam.");
  };

  const reset = async () => {
    if (!/^\d{6}$/.test(code.trim())) return toast.error("El código tiene 6 dígitos");
    if (!Object.values(checks).every(Boolean)) return toast.error("La contraseña no cumple los requisitos");
    if (pw !== pw2) return toast.error("Las contraseñas no coinciden");
    let token: string;
    try {
      ({ token } = await apiPost<{ token: string }>("/api/auth/reset-password", {
        email: email.trim(), code: code.trim(), new_password: pw,
      }));
    } catch (e) {
      return toast.error(translateError(e));
    }
    await setSessionToken(token);
    toast.success("Contraseña cambiada. Se cerraron tus sesiones en otros equipos.");
    navigate({ to: "/app" });
  };

  const header = (
    <CardTitle className="flex items-center gap-2">
      <img src={branding.logo} alt="" className="h-8 w-8 rounded-md object-contain" />
      Recuperar contraseña
    </CardTitle>
  );

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        {isLoading ? (
          <CardHeader>{header}<CardDescription>Cargando…</CardDescription></CardHeader>
        ) : !status?.enabled ? (
          <>
            <CardHeader>
              {header}
              <CardDescription>
                Pide a un administrador de tu sucursal que te asigne una contraseña nueva desde
                <b> Usuarios</b>. Al ingresar, cámbiala en <b>Mi perfil</b>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button asChild className="w-full"><Link to="/auth">Volver a iniciar sesión</Link></Button>
            </CardContent>
          </>
        ) : step === "email" ? (
          <>
            <CardHeader>
              {header}
              <CardDescription>
                Escribe el email de tu usuario en <b>{branding.name}</b>. Te enviaremos un código de 6 dígitos.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-email`}>Email</Label>
                <Input id={`${ids}-email`} type="email" autoComplete="email" autoFocus value={email}
                  onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendCode()} />
              </div>
              <Button className="w-full" onClick={sendCode}>Enviar código</Button>
              <div className="text-center text-sm">
                <Link to="/auth" className="text-muted-foreground underline underline-offset-4">Volver a iniciar sesión</Link>
              </div>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              {header}
              <CardDescription>
                Escribe el código que llegó a <b>{email.trim()}</b> (vence en {status.minutes} minutos) y tu contraseña nueva.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-code`}>Código</Label>
                <Input id={`${ids}-code`} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6}
                  placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  className="text-center font-mono text-2xl tracking-[0.5em]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-pw`}>Contraseña nueva</Label>
                <PasswordInput id={`${ids}-pw`} autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
                <ul className="mt-2 space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
                  <Req ok={checks.len}>Mínimo 10 caracteres</Req>
                  <Req ok={checks.upper}>Al menos una MAYÚSCULA (A-Z)</Req>
                  <Req ok={checks.lower}>Al menos una minúscula (a-z)</Req>
                  <Req ok={checks.num}>Al menos un número (0-9)</Req>
                  <Req ok={checks.sym}>Al menos un símbolo (!@#$...)</Req>
                </ul>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${ids}-pw2`}>Repetir contraseña</Label>
                <PasswordInput id={`${ids}-pw2`} autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && reset()} />
              </div>
              <Button className="w-full" onClick={reset}>Cambiar contraseña</Button>
              <div className="flex items-center justify-between text-sm">
                <button type="button" className="text-muted-foreground underline underline-offset-4" onClick={() => setStep("email")}>
                  Cambiar email
                </button>
                <Button variant="ghost" size="sm" onClick={sendCode} disabled={wait > 0}>
                  {wait > 0 ? `Reenviar código (${wait} s)` : "Reenviar código"}
                </Button>
              </div>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
