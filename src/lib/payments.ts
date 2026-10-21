// Métodos de pago (mismos valores que la API: payments.method) y cómo se muestran.
export type PaymentMethod = "cash" | "qr" | "card";
export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "qr", label: "QR" },
  { value: "card", label: "Tarjeta" },
];
export const methodLabel = (m?: string | null) => PAYMENT_METHODS.find((x) => x.value === m)?.label ?? "—";
