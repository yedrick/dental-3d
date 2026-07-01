import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, Stethoscope, ClipboardList, Wallet, Percent, Landmark } from "lucide-react";
import { formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

function Dashboard() {
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [pat, doc, ps, cash, com, dep] = await Promise.all([
        supabase.from("patients").select("id", { count: "exact", head: true }),
        supabase.from("doctors").select("id", { count: "exact", head: true }),
        supabase.from("patient_studies").select("id,price,created_at").gte("created_at", today),
        supabase.from("cashbox").select("balance").order("created_at", { ascending: false }).limit(1),
        supabase.from("commissions").select("commission_amount").gte("created_at", today),
        supabase.from("bank_deposits").select("amount").gte("deposit_date", today),
      ]);
      const income = (ps.data ?? []).reduce((s: number, r: any) => s + Number(r.price ?? 0), 0);
      const commissionsToday = (com.data ?? []).reduce((s: number, r: any) => s + Number(r.commission_amount ?? 0), 0);
      const depositsToday = (dep.data ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
      return {
        patients: pat.count ?? 0,
        doctors: doc.count ?? 0,
        studiesToday: (ps.data ?? []).length,
        incomeToday: income,
        cashboxBalance: Number((cash.data?.[0] as any)?.balance ?? 0),
        commissionsToday,
        depositsToday,
      };
    },
  });

  const cards = [
    { icon: Users, label: "Pacientes totales", val: data?.patients ?? 0 },
    { icon: Stethoscope, label: "Doctores", val: data?.doctors ?? 0 },
    { icon: ClipboardList, label: "Atenciones hoy", val: data?.studiesToday ?? 0 },
    { icon: Wallet, label: "Ingresos hoy", val: formatMoney(data?.incomeToday) },
    { icon: Percent, label: "Comisiones hoy", val: formatMoney(data?.commissionsToday) },
    { icon: Landmark, label: "Depósitos hoy", val: formatMoney(data?.depositsToday) },
  ];

  return (
    <div>
      <PageHeader title="Dashboard" description="Movimientos del día y estado general." />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{c.val}</div></CardContent>
          </Card>
        ))}
        <Card className="md:col-span-2 lg:col-span-3">
          <CardHeader><CardTitle className="text-sm">Saldo caja chica</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{formatMoney(data?.cashboxBalance)}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}
