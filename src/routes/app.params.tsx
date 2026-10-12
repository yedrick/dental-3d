import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { apiGet, apiPatch } from "@/lib/api";
import { STALE } from "@/lib/query-config";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Save } from "lucide-react";

type Param = {
  key: string;
  value_num: number | string | null;
  value_text: string | null;
  value_bool: boolean | number | null;
  description: string | null;
  updated_at: string;
  updated_by: string | null;
};

/** Parámetros de sí/no (p. ej. cashbox_allow_negative): value_bool no es null. */
const isBool = (p: Param) => p.value_bool !== null && p.value_bool !== undefined;

/** Lista vacía estable (un [] nuevo en cada dibujo hacía que los efectos se repitieran sin fin) */
const NO_PARAMS: Param[] = [];

export const Route = createFileRoute("/app/params")({ component: ParamsPage });

function ParamsPage() {
  const uid = useId(); // ids para unir cada etiqueta con su campo
  const { can } = useAuth();
  const canEdit = can("params.edit");
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["app_params"],
    queryFn: () => apiGet<Param[]>("/api/params"),
    staleTime: STALE.catalog,
  });
  const params = data ?? NO_PARAMS;

  // Solo se guardan los valores que se están editando; el resto se muestra tal como está en la base.
  // (Antes se copiaba todo en cada carga: con un error de la API entraba en un ciclo sin fin, y al
  // guardar un parámetro se perdía lo que se estaba escribiendo en los otros.)
  const [edits, setEdits] = useState<Record<string, string>>({});
  const shown = (p: Param) => edits[p.key] ?? p.value_num?.toString() ?? p.value_text ?? "";

  const patch = async (key: string, body: { value_num: number } | { value_bool: boolean }) => {
    try {
      await apiPatch(`/api/params/${encodeURIComponent(key)}`, body);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Parámetro actualizado");
    await qc.invalidateQueries({ queryKey: ["app_params"] });
    setEdits(({ [key]: _saved, ...rest }) => rest); // ya guardado: vuelve a mostrar el valor de la base
  };

  const save = async (key: string) => {
    const p = params.find((x) => x.key === key);
    const v = p ? shown(p) : undefined;
    const num = v === "" || v === undefined ? NaN : Number(v);
    if (!Number.isFinite(num)) return toast.error("Ingresa un valor numérico");
    await patch(key, { value_num: num });
  };

  return (
    <div>
      <PageHeader title="Parámetros del sistema" description="Valores configurables que afectan cálculos de comisión, recargos y descuentos." />
      <div className="grid gap-3 md:grid-cols-2">
        {params.map((p) => (
          <Card key={p.key} className="p-4">
            <div className="mb-2">
              <div className="font-medium text-sm">{p.description}</div>
              <div className="text-xs text-muted-foreground font-mono">{p.key}</div>
            </div>
            {isBool(p) ? (
              <div className="flex items-center gap-2">
                <Switch
                  aria-label={p.description || p.key}
                  checked={Boolean(Number(p.value_bool))}
                  disabled={!canEdit}
                  onCheckedChange={(v) => patch(p.key, { value_bool: v })}
                />
                <Label className="text-xs">{Number(p.value_bool) ? "Sí" : "No"}</Label>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label htmlFor={`${uid}-${p.key}`} className="text-xs">Valor</Label>
                  <Input
                    id={`${uid}-${p.key}`}
                    type="number" step="0.01" inputMode="decimal"
                    value={shown(p)}
                    disabled={!canEdit}
                    onChange={(e) => setEdits({ ...edits, [p.key]: e.target.value })}
                  />
                </div>
                {canEdit && <Button size="sm" aria-label={`Guardar ${p.description || p.key}`} onClick={() => save(p.key)}><Save className="h-4 w-4" /></Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
