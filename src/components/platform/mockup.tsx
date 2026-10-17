import { motion, useReducedMotion } from "motion/react";
import { CheckCircle2, Clock, TrendingUp, Wallet } from "lucide-react";

const BARS = [38, 62, 45, 80, 58, 92, 70];
const DAYS = ["L", "M", "M", "J", "V", "S", "D"];

/**
 * Vista ilustrativa del sistema para la portada (datos de ejemplo, no reales). Se dibuja con HTML y
 * CSS para que pese poco y se vea nítida en cualquier pantalla. Con "reducir movimiento" queda quieta.
 */
export function ProductMockup() {
  const reduce = useReducedMotion();
  return (
    <div className="relative" aria-label="Vista de ejemplo del sistema IONIX" role="img">
      {/* Halo */}
      <div aria-hidden className="absolute -inset-8 rounded-[2rem] bg-gradient-to-tr from-cyan-400/25 via-indigo-500/20 to-fuchsia-500/20 blur-3xl" />

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 30, rotateX: 12 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
        style={{ transformPerspective: 1200 }}
        className="relative overflow-hidden rounded-2xl border border-white/10 bg-[#0d1530]/90 shadow-2xl shadow-cyan-500/10 backdrop-blur"
      >
        {/* Barra de la ventana */}
        <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-400/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
          <span className="ml-3 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[10px] text-white/50">
            tuclinica.ionix.kollatech.site/app
          </span>
        </div>

        <div className="grid grid-cols-[56px_1fr] sm:grid-cols-[120px_1fr]">
          {/* Menú */}
          <div className="space-y-2 border-r border-white/5 p-3">
            {["Dashboard", "Pacientes", "Atenciones", "Entregas", "Reportes"].map((t, i) => (
              <div key={t} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${i === 0 ? "bg-cyan-400/15" : ""}`}>
                <span className={`h-2 w-2 shrink-0 rounded-sm ${i === 0 ? "bg-cyan-300" : "bg-white/20"}`} />
                <span className={`hidden truncate text-[10px] sm:block ${i === 0 ? "text-cyan-100" : "text-white/45"}`}>{t}</span>
              </div>
            ))}
          </div>

          <div className="space-y-3 p-3 sm:p-4">
            {/* Indicadores */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { icon: TrendingUp, label: "Ventas hoy", value: "Bs 3.480", tone: "text-cyan-200" },
                { icon: Wallet, label: "Cobrado", value: "Bs 2.910", tone: "text-emerald-200" },
                { icon: Clock, label: "Por entregar", value: "4", tone: "text-amber-200" },
              ].map((k, i) => (
                <motion.div
                  key={k.label}
                  initial={reduce ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 + i * 0.12 }}
                  className="rounded-lg border border-white/5 bg-white/[0.04] p-2"
                >
                  <k.icon className={`h-3 w-3 ${k.tone}`} />
                  <div className="mt-1 text-[9px] text-white/45">{k.label}</div>
                  <div className={`text-xs font-semibold sm:text-sm ${k.tone}`}>{k.value}</div>
                </motion.div>
              ))}
            </div>

            {/* Gráfico */}
            <div className="rounded-lg border border-white/5 bg-white/[0.03] p-3">
              <div className="mb-2 text-[10px] text-white/50">Atenciones de la semana</div>
              <div className="flex h-24 items-end gap-1.5 sm:h-28">
                {BARS.map((h, i) => (
                  <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <motion.div
                      initial={reduce ? false : { height: 0 }}
                      animate={{ height: `${h}%` }}
                      transition={{ delay: 0.8 + i * 0.07, duration: 0.6, ease: "easeOut" }}
                      className="w-full rounded-t bg-gradient-to-t from-indigo-500/70 to-cyan-300"
                    />
                    <span className="text-[8px] text-white/35">{DAYS[i]}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Última atención */}
            <motion.div
              initial={reduce ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 1.4 }}
              className="flex items-center justify-between rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                <span className="text-[10px] text-white/75">Panorámica + Tomografía · cobrado con QR</span>
              </div>
              <span className="text-[10px] font-semibold text-emerald-200">Bs 450</span>
            </motion.div>
          </div>
        </div>

        {/* Línea de escaneo (efecto de rayos X) */}
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-cyan-300/10 to-transparent"
            initial={{ top: "-25%" }}
            animate={{ top: "110%" }}
            transition={{ duration: 3.8, repeat: Infinity, ease: "linear", repeatDelay: 1.2 }}
          />
        )}
      </motion.div>

      {/* Tarjetas flotantes */}
      <FloatingCard className="-left-4 bottom-24 sm:-left-12" delay={1.1} reduce={reduce}>
        <span className="text-white/60">Comisión Dr. Rojas</span>
        <b className="text-cyan-200">Bs 120 calculada</b>
      </FloatingCard>
      <FloatingCard className="-right-3 -top-6 sm:-right-8" delay={1.3} reduce={reduce}>
        <span className="text-white/60">Cierre del día</span>
        <b className="text-emerald-200">PDF listo</b>
      </FloatingCard>
      <p className="mt-3 text-center text-[11px] text-white/35">Vista de ejemplo, con datos ilustrativos</p>
    </div>
  );
}

function FloatingCard({ children, className, delay, reduce }: { children: React.ReactNode; className: string; delay: number; reduce: boolean | null }) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, scale: 0.85 }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, y: [0, -8, 0] }}
      transition={reduce ? undefined : { opacity: { delay }, scale: { delay }, y: { delay: delay + 0.4, duration: 4, repeat: Infinity, ease: "easeInOut" } }}
      className={`absolute hidden flex-col rounded-xl border border-white/10 bg-[#111a3a]/90 px-3 py-2 text-[11px] shadow-xl backdrop-blur sm:flex ${className}`}
    >
      {children}
    </motion.div>
  );
}
