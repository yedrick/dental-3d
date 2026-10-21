import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBranding } from "@/lib/branding";
import { platformUrl } from "@/lib/plan";

/** Pantalla de un módulo que el plan de la sucursal no incluye (se entró por enlace o marcador). */
export function PlanLocked({ label }: { label: string }) {
  const { planLabel } = useBranding();
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <Card className="max-w-md">
        <CardContent className="space-y-4 pt-6 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10 text-primary">
            <Lock className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">{label} no está en tu plan</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {planLabel ? <>Tu sucursal tiene el plan <b>{planLabel}</b>. </> : null}
              Para usar este módulo, mejora tu plan. Tus datos no se pierden: al mejorar, todo aparece de nuevo.
            </p>
          </div>
          <Button asChild>
            <a href={`${platformUrl()}#planes`} target="_blank" rel="noreferrer">
              <Sparkles className="mr-1 h-4 w-4" /> Ver planes
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
