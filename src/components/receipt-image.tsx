import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ImageIcon } from "lucide-react";

async function signedUrl(path: string) {
  const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

export async function uploadReceipt(file: File, prefix: string): Promise<string | null> {
  const ext = file.name.split(".").pop() || "jpg";
  const path = `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from("receipts").upload(path, file, { upsert: false });
  if (error) throw error;
  return path;
}

export function ReceiptThumb({ path }: { path?: string | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let ok = true;
    if (path) signedUrl(path).then((u) => ok && setUrl(u));
    return () => { ok = false; };
  }, [path]);
  if (!path) return <span className="text-muted-foreground text-xs">—</span>;
  if (!url) return <div className="h-10 w-10 rounded bg-muted animate-pulse" />;
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
