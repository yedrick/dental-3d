import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { tokenStore } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// Destino de "Entrar como…" del panel de la plataforma (tenancy-node). La API canjea el token del
// panel en /api/auth/impersonate y redirige aquí con la sesión en el fragmento (#token=…), que el
// navegador no envía a ningún servidor ni guarda en los logs.
export const Route = createFileRoute("/auth_/impersonate")({
  ssr: false,
  component: ImpersonatePage,
});

function ImpersonatePage() {
  const { setSessionToken } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get("token");
    const redirect = params.get("redirect") ?? "/app";
    // Quitar el token de la barra de direcciones y del historial
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      setError("El enlace no es válido o ya se usó. Vuelve a usar \"Entrar como…\" desde el panel.");
      return;
    }
    tokenStore.clearAdmin();
    setSessionToken(token)
      .then(() => window.location.replace(redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/app"))
      .catch(() => setError("No se pudo abrir la sesión. Vuelve a intentarlo desde el panel."));
  }, [setSessionToken]);

  return (
    <div className="grid min-h-screen place-items-center gap-3 p-4 text-center text-sm text-muted-foreground">
      {error ? <p className="max-w-sm">{error}</p> : (<><Loader2 className="h-6 w-6 animate-spin text-primary" /><div>Entrando…</div></>)}
    </div>
  );
}
