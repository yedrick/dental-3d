import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Save } from "lucide-react";

export const Route = createFileRoute("/app/params")({ component: ParamsPage });

function ParamsPage() {
  const { can, user } = useAuth();
  const canEdit = can("params.edit");
  const qc = useQueryClient();
  const { data: params = [] } = useQuery({
    queryKey: ["app_params"],
    queryFn: async () => {
      const { data, error } = await supabase.from("app_params").select("*").order("key");
      if (error) throw error;
      return data as any[];
    },
  });

  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    const initial: Record<string, string> = {};
    params.forEach((p) => { initial[p.key] = p.value_num?.toString() ?? p.value_text ?? ""; });
    setValues(initial);
  }, [params]);

  const save = async (key: string) => {
    const v = values[key];
    const num = v === "" ? null : Number(v);
    const { error } = await supabase.from("app_params").update({
      value_num: num, updated_at: new Date().toISOString(), updated_by: user?.id,
    }).eq("key", key);
    if (error) return toast.error(error.message);
    toast.success("Parámetro actualizado");
    qc.invalidateQueries({ queryKey: ["app_params"] });
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
          </Card>
        ))}
      </div>
    </div>
  );
}
