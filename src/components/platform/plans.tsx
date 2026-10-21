import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Check, Minus, Sparkles } from "lucide-react";
import { FEATURE_ICONS } from "./data";

export type PublicPlans = {
  defaultPlan: string | null;
  features: { id: string; label: string; description: string | null }[];
  plans: {
    id: string;
    label: string;
    description?: string | null;
    price: { currency: string; monthly?: number | null; yearly?: number | null } | null;
    features: string[];
    limits: Record<string, number | null>;
    highlight: boolean;
  }[];
};

/** Planes, módulos y precios desde la configuración (GET /tenancy/plans, público y con ETag). */
export function usePublicPlans() {
  return useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => {
      const res = await fetch("/tenancy/plans", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`planes: ${res.status}`);
      return (await res.json()) as PublicPlans;
    },
    staleTime: 5 * 60_000,
  });
}

const money = (n: number, currency: string) =>
  new Intl.NumberFormat("es-BO", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

const usersLimit = (n: number | null | undefined) =>
  n === null || n === undefined ? "Usuarios sin límite" : `Hasta ${n} usuario${n === 1 ? "" : "s"}`;

export function PlansSection({ onChoose }: { onChoose: (planId: string) => void }) {
  const { data, isLoading, isError } = usePublicPlans();
  const [yearly, setYearly] = useState(false);
  const hasYearly = data?.plans.some((p) => p.price?.yearly) ?? false;

  if (isLoading)
    return (
      <div className="grid gap-5 md:grid-cols-3" aria-busy="true">
        {[0, 1, 2].map((i) => <div key={i} className="h-[440px] animate-pulse rounded-3xl bg-white/[0.04]" />)}
      </div>
    );
  if (isError || !data?.plans.length)
    return <p className="text-center text-white/60">Los planes no se pudieron cargar. Escríbenos y te los enviamos.</p>;

  return (
    <div>
      {hasYearly && (
        <div className="mb-8 flex justify-center">
          <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm" role="group" aria-label="Forma de pago">
            {[false, true].map((y) => (
              <button
                key={String(y)}
                type="button"
                aria-pressed={yearly === y}
                onClick={() => setYearly(y)}
                className={`rounded-full px-4 py-1.5 transition ${yearly === y ? "bg-white text-[#070b1d]" : "text-white/70 hover:text-white"}`}
              >
                {y ? "Anual" : "Mensual"}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 md:grid-cols-3">
        {data.plans.map((plan, i) => {
          const amount = yearly ? plan.price?.yearly : plan.price?.monthly;
          return (
            <motion.article
              key={plan.id}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              whileHover={{ y: -6 }}
              className={`relative flex flex-col rounded-3xl border p-6 sm:p-7 ${
                plan.highlight
                  ? "border-cyan-300/50 bg-gradient-to-b from-cyan-400/[0.12] to-indigo-500/[0.06] shadow-2xl shadow-cyan-500/10"
                  : "border-white/10 bg-white/[0.03]"
              }`}
            >
              {plan.highlight && (
                <span className="absolute -top-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-cyan-300 px-3 py-1 text-xs font-semibold text-[#070b1d]">
                  <Sparkles className="h-3 w-3" /> Más elegido
                </span>
              )}
              <h3 className="font-display text-xl font-semibold">{plan.label}</h3>
              {plan.description && <p className="mt-1 min-h-[2.5rem] text-sm text-white/60">{plan.description}</p>}
              <div className="mt-5">
                {amount ? (
                  <>
                    <span className="font-display text-4xl font-bold">{money(amount, plan.price!.currency)}</span>
                    <span className="text-sm text-white/50"> / {yearly ? "año" : "mes"}</span>
                  </>
                ) : (
                  <span className="font-display text-3xl font-bold">A consultar</span>
                )}
              </div>
              <p className="mt-1 text-sm text-white/55">{usersLimit(plan.limits.usuarios)}</p>

              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                <li className="flex items-start gap-2 text-white/85">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" /> Pacientes, atenciones, cobros, doctores y estudios
                </li>
                {data.features.map((f) => {
                  const included = plan.features.includes(f.id);
                  const Icon = included ? Check : Minus;
                  return (
                    <li key={f.id} className={`flex items-start gap-2 ${included ? "text-white/85" : "text-white/30"}`}>
                      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${included ? "text-cyan-300" : ""}`} />
                      <span>
                        {f.label}
                        <span className="sr-only">{included ? " (incluido)" : " (no incluido)"}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>

              <button
                type="button"
                onClick={() => onChoose(plan.id)}
                className={`mt-7 rounded-xl px-4 py-3 text-sm font-semibold transition ${
                  plan.highlight ? "bg-cyan-300 text-[#070b1d] hover:bg-cyan-200" : "border border-white/15 bg-white/5 hover:bg-white/10"
                }`}
              >
                Solicitar demo con {plan.label}
              </button>
            </motion.article>
          );
        })}
      </div>

      {/* Qué hace cada módulo */}
      <div className="mt-14 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {data.features.map((f) => {
          const Icon = FEATURE_ICONS[f.id] ?? Check;
          return (
            <div key={f.id} className="rounded-2xl border border-white/5 bg-white/[0.02] p-4">
              <Icon className="h-5 w-5 text-cyan-300" />
              <div className="mt-2 text-sm font-semibold">{f.label}</div>
              {f.description && <div className="mt-1 text-xs text-white/55">{f.description}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
