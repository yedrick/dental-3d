import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import { STALE } from "@/lib/query-config";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Users, Stethoscope, ClipboardList, Wallet, Percent, Landmark, HandCoins } from "lucide-react";
import { formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { translateError } from "@/lib/translate-error";

export const Route = createFileRoute("/app/")({
  component: Dashboard,
});

type DashboardData = {
  date: string;
  /** "doctor": usuario DOCTOR, solo sus números (los de la clínica vienen en null) */
  scope: "clinic" | "doctor";
  /** Usuario DOCTOR enlazado a su ficha de doctor */
  linked?: boolean;
  patients: number;
  doctors: number | null;
  attentions_today: number;
  /** Ventas de hoy: precio + recargo − descuento */
  income_today: number | null;
  /** Cobrado hoy por la fecha de cada pago, aunque la atención sea de otro día */
  collected_today: number | null;
  /** De lo cobrado hoy, lo que corresponde a atenciones de días anteriores */
  collected_today_previous: number | null;
  commissions_today: number;
  deposits_today: number | null;
  cashbox_balance: number | null;
};

function Dashboard() {
  // Todo se calcula en la API (día de hoy en la hora local del negocio)
  const { data, error, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<DashboardData>("/api/dashboard"),
    staleTime: STALE.money,
  });
  const isDoctor = data?.scope === "doctor";
  const previous = data?.collected_today_previous ?? 0;

  const cards = isDoctor
    ? [
        { icon: Users, label: "Mis pacientes", val: data?.patients ?? 0 },
        { icon: ClipboardList, label: "Mis atenciones hoy", val: data?.attentions_today ?? 0 },
        { icon: Percent, label: "Mis comisiones hoy", val: formatMoney(data?.commissions_today) },
      ]
    : [
        { icon: Users, label: "Pacientes totales", val: data?.patients ?? 0 },
        { icon: Stethoscope, label: "Doctores", val: data?.doctors ?? 0 },
        { icon: ClipboardList, label: "Atenciones hoy", val: data?.attentions_today ?? 0 },
        { icon: Wallet, label: "Ventas de hoy", val: formatMoney(data?.income_today) },
        {
          icon: HandCoins, label: "Cobrado hoy", val: formatMoney(data?.collected_today),
          // Saldos de atenciones de otros días que se pagaron hoy
          note: previous > 0 ? `Incluye ${formatMoney(previous)} de atenciones de días anteriores` : undefined,
        },
        { icon: Percent, label: "Comisiones hoy", val: formatMoney(data?.commissions_today) },
        { icon: Landmark, label: "Depósitos hoy", val: formatMoney(data?.deposits_today) },
      ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description={isDoctor ? "Tus pacientes, atenciones y comisiones." : "Movimientos del día y estado general."}
      />
      {error && (
        <Card className="mb-4 border-destructive/50 bg-destructive/5 p-4 text-sm text-destructive" role="alert">
          No se pudieron cargar los datos del día: {translateError(error)}
        </Card>
      )}
      {isDoctor && data?.linked === false && (
        <Card className="mb-4 border-amber-500/50 bg-amber-50 p-4 text-sm dark:bg-amber-950/30" role="status">
          Tu usuario no está enlazado a una ficha de doctor. Pide a un administrador que lo enlace en Usuarios.
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
              <c.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-8 w-24" /> : <div className="text-2xl font-bold">{error ? "—" : c.val}</div>}
              {"note" in c && c.note && <p className="mt-1 text-xs text-muted-foreground">{c.note}</p>}
            </CardContent>
          </Card>
        ))}
        {!isDoctor && (
          <Card className="md:col-span-2 lg:col-span-3">
            <CardHeader><CardTitle className="text-sm">Saldo caja chica</CardTitle></CardHeader>
            <CardContent>
              {isLoading ? <Skeleton className="h-9 w-32" /> : <div className="text-3xl font-bold">{error ? "—" : formatMoney(data?.cashbox_balance)}</div>}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
