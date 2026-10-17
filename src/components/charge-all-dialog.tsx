import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { formatMoney } from "@/lib/data";
import { type PaymentMethod } from "@/lib/payments";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PaymentMethodSelect } from "@/components/payment-method-select";

export interface ChargeAllTarget {
  patientName: string;
  /** Saldo total que se va a cobrar */
  debt: number;
  total?: number;
  paid?: number;
}

/**
 * Confirmación de "Cobrar todo": muestra el paciente y el saldo, y pide la forma de pago.
 * Nada se cobra hasta pulsar "Cobrar"; el botón se bloquea mientras se registra.
 */
export function ChargeAllDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: ChargeAllTarget | null;
  onCancel: () => void;
  onConfirm: (method: PaymentMethod) => Promise<unknown>;
}) {
  const [method, setMethod] = useState<PaymentMethod>("cash");
  useEffect(() => { if (target) setMethod("cash"); }, [target]);
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Cobrar saldo</DialogTitle>
          <DialogDescription>Se cobrará todo lo que debe el paciente. Revisa el monto antes de confirmar.</DialogDescription>
        </DialogHeader>
        {target && (
          <div className="space-y-4 py-2">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Paciente</div>
              <div className="font-medium">{target.patientName}</div>
            </div>
            <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/30 p-4 text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Monto a cobrar</div>
              <div className="text-3xl font-bold font-mono text-amber-700 dark:text-amber-400">{formatMoney(target.debt)}</div>
            </div>
            {(target.total !== undefined || target.paid !== undefined) && (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><div className="text-muted-foreground text-xs">Total</div><div className="font-mono">{formatMoney(target.total ?? 0)}</div></div>
                <div><div className="text-muted-foreground text-xs">Pagado</div><div className="font-mono">{formatMoney(target.paid ?? 0)}</div></div>
              </div>
            )}
            <PaymentMethodSelect value={method} onChange={setMethod} />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button onClick={() => onConfirm(method)}>
            <Wallet className="h-4 w-4 mr-1" />Cobrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
