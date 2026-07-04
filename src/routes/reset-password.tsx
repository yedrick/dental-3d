import { translateError } from "@/lib/translate-error";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Eye, EyeOff, Check, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Restablecer contraseña · 3 Dental Imagen" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase automatically handles the recovery token in the URL hash and creates a session.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session)) {
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const checks = useMemo(() => ({
    len: password.length >= 10,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    num: /[0-9]/.test(password),
    sym: /[^A-Za-z0-9]/.test(password),
  }), [password]);
  const allOk = Object.values(checks).every(Boolean);

  const submit = async () => {
    if (!allOk) { toast.error("La contraseña no cumple los requisitos."); return; }
    if (password !== confirm) { toast.error("Las contraseñas no coinciden."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) {
      const m = error.message.toLowerCase();
      if (m.includes("pwned") || m.includes("weak")) {
        toast.error("Esta contraseña aparece en filtraciones públicas. Usa una nueva y única.", { duration: 8000 });
      } else {
        toast.error(translateError(error));
      }
      return;
    }
    toast.success("Contraseña actualizada. Ingresando…");
    setTimeout(() => navigate({ to: "/app" }), 800);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Restablecer contraseña</CardTitle>
          <CardDescription>
            {ready ? "Ingresa tu nueva contraseña." : "Validando enlace de recuperación…"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!ready ? (
            <p className="text-sm text-muted-foreground">
              Si abriste este enlace desde el correo y sigue cargando, el enlace pudo haber caducado. Solicita uno nuevo desde "Olvidé mi contraseña".
            </p>
          ) : (
            <>
              <div>
                <Label>Nueva contraseña</Label>
                <div className="relative">
                  <Input
                    type={showPwd ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pr-10"
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPwd((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPwd ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <ul className="mt-2 space-y-1 rounded-md border bg-muted/40 p-2 text-xs">
                  <Req ok={checks.len}>Mínimo 10 caracteres</Req>
                  <Req ok={checks.upper}>Una mayúscula</Req>
                  <Req ok={checks.lower}>Una minúscula</Req>
                  <Req ok={checks.num}>Un número</Req>
                  <Req ok={checks.sym}>Un símbolo</Req>
                </ul>
              </div>
              <div>
                <Label>Confirmar contraseña</Label>
                <Input
                  type={showPwd ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <Button onClick={submit} disabled={busy || !allOk} className="w-full">
                Actualizar contraseña
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Req({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-primary" : "text-muted-foreground"}`}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
      <span>{children}</span>
    </li>
  );
}
