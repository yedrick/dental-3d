import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/payments";

/** "Forma de pago" (Efectivo · QR · Tarjeta): cada cobro queda registrado con su método. */
export function PaymentMethodSelect({
  value,
  onChange,
  className,
  label = "Forma de pago",
}: {
  value: PaymentMethod;
  onChange: (v: PaymentMethod) => void;
  className?: string;
  label?: string;
}) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={(v) => onChange(v as PaymentMethod)}>
        <SelectTrigger id={id} className="h-9"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PAYMENT_METHODS.map((m) => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}
