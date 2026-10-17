import {
  Activity, BarChart3, CalendarDays, ClipboardList, FileSpreadsheet, Globe, Landmark, Palette,
  PackageCheck, Percent, ShieldCheck, Stethoscope, TestTube2, UserCog, Users, Wallet, type LucideIcon,
} from "lucide-react";

// Contenido de la web comercial de IONIX (dominio principal). Los planes, módulos y precios NO están
// aquí: vienen de GET /tenancy/plans (server/src/tenancy/plans.ts), así nunca se contradicen.

/** Lo que tienen todos los planes. */
export const CORE: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: Users, title: "Pacientes", text: "Ficha con historial de atenciones, pagos y citas." },
  { icon: ClipboardList, title: "Atenciones", text: "Registro rápido con varios estudios, descuentos y factura." },
  { icon: PackageCheck, title: "Entregas y cobros", text: "Saldos pendientes, cobros parciales y 'cobrar todo'." },
  { icon: Stethoscope, title: "Doctores", text: "Doctores que derivan, con su comisión fija o por porcentaje." },
  { icon: TestTube2, title: "Estudios y tarifas", text: "Precios con y sin informe, siempre actualizados." },
  { icon: UserCog, title: "Usuarios y roles", text: "Recepción, caja, contabilidad, doctor: cada uno ve lo suyo." },
  { icon: Palette, title: "Tu marca", text: "Logo, colores y tipografía de tu clínica en todo el sistema." },
  { icon: Activity, title: "Dashboard", text: "Lo importante del día apenas entras." },
];

/** Ícono de cada módulo del plan (las llaves de features en plans.ts). */
export const FEATURE_ICONS: Record<string, LucideIcon> = {
  agenda: CalendarDays,
  caja: Wallet,
  comisiones: Percent,
  reportes: BarChart3,
  pagina_web: Globe,
  importar: FileSpreadsheet,
  finanzas: Landmark,
  auditoria: ShieldCheck,
};

export const PROBLEMS: { before: string; after: string }[] = [
  {
    before: "Cobros parciales anotados en un cuaderno, y nadie sabe cuánto debe cada paciente.",
    after: "Cada pago queda con su fecha y forma de pago. El saldo se ve en la ficha y en Entregas.",
  },
  {
    before: "Fin de mes: calcular a mano la comisión de cada doctor.",
    after: "Las comisiones se calculan solas al registrar la atención, con Excel y PDF por doctor.",
  },
  {
    before: "¿Cuánto entró hoy? Sumar papeles de caja, depósitos y pagos a terceros.",
    after: "Reportes por día, semana o mes: ventas, cobrado, caja y utilidad, en pantalla o en PDF.",
  },
  {
    before: "Una página web cara que nadie actualiza.",
    after: "Tu clínica tiene su propia página web, editable desde el sistema, con WhatsApp y tus estudios.",
  },
];

export const STEPS: { title: string; text: string }[] = [
  { title: "Solicitas tu demo", text: "Nos cuentas de tu clínica y el plan que te interesa." },
  { title: "Creamos tu clínica", text: "Tu propio subdominio, tu base de datos y tus estudios y tarifas cargados." },
  { title: "Empiezas a atender", text: "Tu equipo entra desde la computadora o el celular, sin instalar nada." },
];

/** Solo lo que el sistema hace de verdad (ver server/README.md). */
export const SECURITY: string[] = [
  "Cada clínica tiene su propia base de datos y su propio usuario de base de datos.",
  "Las credenciales de cada base se guardan cifradas (AES-256-GCM).",
  "Contraseñas guardadas con bcrypt (nunca en texto plano) y sesiones que se cierran al cambiarla.",
  "Roles y permisos por pantalla: cada persona ve solo lo que le corresponde.",
  "Los comprobantes solo se abren con enlaces firmados que vencen.",
  "Conexión cifrada (HTTPS) en todos los subdominios.",
];

export const FAQ: { q: string; a: string }[] = [
  { q: "¿Tengo que instalar algo?", a: "No. IONIX funciona en el navegador, en la computadora, la tablet o el celular. Solo necesitas internet." },
  { q: "¿Mis datos se mezclan con los de otras clínicas?", a: "No. Cada clínica tiene su propia base de datos, separada de las demás, y su propio subdominio." },
  { q: "¿Puedo cambiar de plan después?", a: "Sí, en cualquier momento. Si bajas de plan no se borra nada: el módulo se oculta, y al volver a subir todo reaparece." },
  { q: "¿Puedo cargar mis estudios y tarifas desde Excel?", a: "Sí. En los planes que incluyen 'Importar Excel' descargas la plantilla, la llenas y la subes; el sistema revisa todo antes de guardar." },
  { q: "¿Cada doctor puede ver sus pacientes?", a: "Sí. Un usuario con rol Doctor ve solo sus pacientes, sus atenciones y sus comisiones." },
  { q: "¿Mi clínica tiene página web?", a: "En los planes con 'Página web' tu clínica tiene su portada con estudios, horarios, ubicación y WhatsApp, y la editas tú mismo." },
];
