import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Recuperar contraseña · 3 Dental Imagen" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

// Recuperar la contraseña por email queda pendiente hasta elegir un servicio de correo
// (server/PLAN.md). Mientras tanto, un administrador asigna una contraseña nueva.
function ResetPasswordPage() {
  const branding = useBranding();
  return (
    <div className="grid min-h-screen place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <img src={branding.logo} alt="" className="h-8 w-8 rounded-md object-contain" />
            Recuperar contraseña
          </CardTitle>
          <CardDescription>
            Pide a un administrador de tu sucursal que te asigne una contraseña nueva desde
            <b> Usuarios</b>. Al ingresar, cámbiala en <b>Mi perfil</b>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="w-full"><Link to="/auth">Volver a iniciar sesión</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
