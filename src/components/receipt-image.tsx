import { useEffect, useState } from "react";
import { apiGet, apiUpload } from "@/lib/api";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { FileText, ImageIcon } from "lucide-react";

// Comprobantes en el almacenamiento PRIVADO de la sucursal (API /api/receipts).
// Se ven con un enlace firmado que vence en 5 minutos.

async function signedUrl(key: string) {
  try {
    return (await apiGet<{ url: string }>("/api/receipts/url", { key })).url;
  } catch {
    return null;
  }
}

/** Sube el archivo (imagen o PDF, máx. 5 MB) y devuelve la llave para enviarla como receipt_key. */
export async function uploadReceipt(file: File): Promise<string> {
  return (await apiUpload<{ key: string }>("/api/receipts", file)).key;
}

export function ReceiptThumb({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const isPdf = path?.toLowerCase().endsWith(".pdf");
  useEffect(() => {
    let ok = true;
    setUrl(null);
    setFailed(false);
    if (path) signedUrl(path).then((u) => ok && (u ? setUrl(u) : setFailed(true)));
    return () => { ok = false; };
  }, [path]);
  if (!path) return <span className="text-muted-foreground text-xs">—</span>;
  if (failed) return <span className="text-muted-foreground text-xs" title={path}>No disponible</span>;
  if (!url) return <div className="h-10 w-10 rounded bg-muted animate-pulse" />;
  if (isPdf) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
        <FileText className="h-4 w-4" /> PDF
      </a>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="group relative">
        <img src={url} alt="Comprobante" className="h-12 w-12 rounded object-cover border hover:opacity-80" />
        <ImageIcon className="absolute -bottom-1 -right-1 h-4 w-4 bg-background rounded p-0.5 border" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-3xl">
          <img src={url} alt="Comprobante" className="w-full h-auto rounded" />
        </DialogContent>
      </Dialog>
    </>
  );
}
