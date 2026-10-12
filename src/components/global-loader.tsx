import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useActivity } from "@/lib/activity";

// Tiempos: nada si la respuesta es rápida (sin parpadeos); barra si pasa de 0,2 s; aviso con texto
// al guardar (0,6 s) o al cargar (1,5 s); y si pasa de 8 s, se avisa que está tardando.
const BAR_AFTER = 200;
const WRITE_TEXT_AFTER = 600;
const READ_TEXT_AFTER = 1500;
const SLOW_AFTER = 8000;

/**
 * Indicador global de carga: una barra fina arriba, del color de la sucursal, y un aviso abajo a la
 * derecha ("Guardando…", "Cargando…"). Cuenta todas las peticiones a la API (lib/activity.ts).
 */
export function GlobalLoader() {
  const { reads, writes, since } = useActivity();
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (since === null) {
      setElapsed(0);
      return;
    }
    const tick = () => setElapsed(Date.now() - since);
    tick();
    const t = setInterval(tick, 100);
    return () => clearInterval(t);
  }, [since]);

  const busy = since !== null;
  const showBar = busy && elapsed >= BAR_AFTER;
  const saving = writes > 0;
  const showText = busy && elapsed >= (saving ? WRITE_TEXT_AFTER : READ_TEXT_AFTER);
  const slow = elapsed >= SLOW_AFTER;

  return (
    <>
      <div
        aria-hidden={!showBar}
        className={`pointer-events-none fixed inset-x-0 top-0 z-[100] h-[3px] overflow-hidden bg-primary/15 transition-opacity duration-300 ${showBar ? "opacity-100" : "opacity-0"}`}
      >
        {showBar && (
          <div className="loader-bar h-full w-2/5 rounded-full bg-primary shadow-[0_0_8px_var(--primary)]" />
        )}
      </div>
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-none fixed bottom-4 right-4 z-[100] transition-all duration-300 ${showText ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
      >
        {showText && (
          <div className="flex items-center gap-2 rounded-full border bg-background/95 px-3.5 py-2 text-xs font-medium shadow-lg backdrop-blur">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span>{saving ? "Guardando…" : "Cargando…"}</span>
            {slow && <span className="text-muted-foreground">Está tardando más de lo normal</span>}
          </div>
        )}
      </div>
    </>
  );
}
