import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Activity, ShieldCheck, Wallet } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (user) return <Navigate to="/app" />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <header className="mx-auto flex max-w-6xl items-center justify-between p-6">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">D3</div>
          Dental-3D
        </div>
        <Button asChild><Link to="/auth">Ingresar</Link></Button>
      </header>
      <main className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        <h1 className="text-4xl font-bold tracking-tight md:text-5xl">
          Gestión clínica, administrativa y financiera<br />para tu centro radiológico dental
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-muted-foreground">
          Control de doctores, pacientes, tarifas centralizadas, comisiones automáticas,
          caja chica precisa y auditoría total del sistema.
        </p>
        <div className="mt-8"><Button size="lg" asChild><Link to="/auth">Comenzar</Link></Button></div>

        <div className="mt-16 grid gap-6 md:grid-cols-3">
          {[
            { icon: Activity, title: "Control clínico", desc: "Pacientes vinculados a doctores, estudios con precio automático desde tarifa activa." },
            { icon: Wallet, title: "Finanzas reales", desc: "Caja chica siempre actualizada, comisiones automáticas, pagos a terceros." },
            { icon: ShieldCheck, title: "Auditoría total", desc: "Cada cambio queda registrado con usuario, tabla y timestamp." },
          ].map((f) => (
            <div key={f.title} className="rounded-lg border bg-card p-6">
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-3 font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
