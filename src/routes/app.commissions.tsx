import { createFileRoute } from "@tanstack/react-router";
import { useList, formatDate, formatMoney } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const Route = createFileRoute("/app/commissions")({ component: CommissionsPage });

function CommissionsPage() {
  const { data: rows = [] } = useList<any>("commissions");
  const { data: doctors = [] } = useList<any>("doctors", "full_name", true);
  const dmap = new Map(doctors.map((d: any) => [d.id, d.full_name]));

  const total = rows.reduce((s: number, r: any) => s + Number(r.commission_amount ?? 0), 0);

  return (
    <div>
      <PageHeader title="Comisiones" description={`Total acumulado: ${formatMoney(total)}`} />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Doctor</TableHead><TableHead>%</TableHead><TableHead>Monto</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell>{formatDate(r.created_at)}</TableCell>
                <TableCell>{dmap.get(r.doctor_id) || "-"}</TableCell>
                <TableCell>{r.percentage}%</TableCell>
                <TableCell>{formatMoney(r.commission_amount)}</TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && <TableRow><TableCell colSpan={4} className="text-muted-foreground">Sin comisiones.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
