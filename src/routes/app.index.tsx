import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { STALE } from "@/lib/query-config";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, Stethoscope, ClipboardList, Wallet, Percent, Landmark, HandCoins } from "lucide-react";
import { formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

type DashboardData = {
  date: string;
  patients: number;
  doctors: number;
  attentions_today: number;
  /** Facturado hoy: precio + recargo − descuento */
  income_today: number;
  collected_today: number;
  commissions_today: number;
  deposits_today: number;
  cashbox_balance: number;
};

function Dashboard() {
  // Todo se calcula en la API (día de hoy en la hora local del negocio)
  const { data } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/api/dashboard"),
    staleTime: STALE.money,
  });

  const cards = [
    { icon: Users, label: "Pacientes totales", val: data?.patients ?? 0 },
    { icon: Stethoscope, label: "Doctores", val: data?.doctors ?? 0 },
    { icon: ClipboardList, label: "Atenciones hoy", val: data?.attentions_today ?? 0 },
    { icon: Wallet, label: "Facturado hoy", val: formatMoney(data?.income_today) },
    { icon: HandCoins, label: "Cobrado hoy", val: formatMoney(data?.collected_today) },
    { icon: Percent, label: "Comisiones hoy", val: formatMoney(data?.commissions_today) },
    { icon: Landmark, label: "Depósitos hoy", val: formatMoney(data?.deposits_today) },
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
          <CardContent><div className="text-3xl font-bold">{formatMoney(data?.cashbox_balance)}</div></CardContent>
        </Card>
      </div>
    </div>
  );
}
