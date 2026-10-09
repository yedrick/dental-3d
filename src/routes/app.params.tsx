import { translateError } from "@/lib/translate-error";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
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

export const Route = createFileRoute("/app/params")({ component: ParamsPage });

function ParamsPage() {
  const { can } = useAuth();
  const canEdit = can("params.edit");
  const qc = useQueryClient();
  const { data: params = [] } = useQuery({
    queryKey: ["app_params"],
    queryFn: () => apiGet<Param[]>("/api/params"),
    staleTime: STALE.catalog,
  });

  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const initial: Record<string, string> = {};
    params.forEach((p) => { initial[p.key] = p.value_num?.toString() ?? p.value_text ?? ""; });
    setValues(initial);
  }, [params]);

  const patch = async (key: string, body: { value_num: number } | { value_bool: boolean }) => {
    try {
      await apiPatch(`/api/params/${encodeURIComponent(key)}`, body);
    } catch (e) {
      return toast.error(translateError(e));
    }
    toast.success("Parámetro actualizado");
    qc.invalidateQueries({ queryKey: ["app_params"] });
  };

  const save = async (key: string) => {
    const v = values[key];
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
                  checked={Boolean(Number(p.value_bool))}
                  disabled={!canEdit}
                  onCheckedChange={(v) => patch(p.key, { value_bool: v })}
                />
                <Label className="text-xs">{Number(p.value_bool) ? "Sí" : "No"}</Label>
              </div>
            ) : (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs">Valor</Label>
                  <Input
                    type="number" step="0.01" inputMode="decimal"
                    value={values[p.key] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                  />
                </div>
                {canEdit && <Button size="sm" onClick={() => save(p.key)}><Save className="h-4 w-4" /></Button>}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
