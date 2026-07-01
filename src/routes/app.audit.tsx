import { createFileRoute } from "@tanstack/react-router";
import { useList } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/app/audit")({ component: AuditPage });

function AuditPage() {
  const { data = [] } = useList<any>("audit_logs", "timestamp");
  return (
    <div>
      <PageHeader title="Auditoría" description="Registro automático de todos los cambios en el sistema." />
      <Card>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Fecha</TableHead><TableHead>Acción</TableHead><TableHead>Tabla</TableHead>
            <TableHead>Registro</TableHead><TableHead>Usuario</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {data.map((r: any) => (
              <TableRow key={r.id}>
                <TableCell className="text-xs">{new Date(r.timestamp).toLocaleString()}</TableCell>
                <TableCell><Badge variant={r.action === "DELETE" ? "destructive" : r.action === "INSERT" ? "default" : "secondary"}>{r.action}</Badge></TableCell>
                <TableCell>{r.table_name}</TableCell>
                <TableCell className="font-mono text-xs">{r.record_id}</TableCell>
                <TableCell className="font-mono text-xs">{r.user_id?.slice(0, 8) || "-"}</TableCell>
              </TableRow>
            ))}
            {data.length === 0 && <TableRow><TableCell colSpan={5} className="text-muted-foreground">Sin registros.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
