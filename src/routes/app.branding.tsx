import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { apiDelete, apiPatch, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useBranding } from "@/lib/branding";
import { translateError } from "@/lib/translate-error";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/branding")({ component: BrandingPage });

const LOGO_MAX_BYTES = 1024 * 1024;
const HEX = /^#([0-9a-fA-F]{6})$/;

/**
 * Marca de la sucursal (permiso branding.edit). Se guarda con tenancy-node en la API y se
 * aplica a todos los usuarios de la sucursal: logo, nombre y color principal.
 */
function BrandingPage() {
  const { can } = useAuth();
  const branding = useBranding();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [primary, setPrimary] = useState("#0F172A");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!branding.loaded) return;
    setName(branding.name);
    setAddress(branding.address ?? "");
    setPhone(branding.phone ?? "");
    setPrimary(branding.primary && HEX.test(branding.primary) ? branding.primary : "#0F172A");
  }, [branding.loaded, branding.name, branding.address, branding.phone, branding.primary]);

  if (!can("branding.edit")) {
    return <div className="p-6 text-sm text-muted-foreground">No tienes permiso para cambiar la marca de la sucursal.</div>;
  }

  const save = async () => {
    if (!name.trim()) return toast.error("El nombre es obligatorio");
    if (!HEX.test(primary)) return toast.error("El color debe tener la forma #RRGGBB");
    setSaving(true);
    try {
      await apiPatch("/api/branding", {
        name: name.trim(),
        address: address.trim() || null,
        phone: phone.trim() || null,
        theme: { primary },
      });
      await branding.reload();
      toast.success("Marca actualizada para toda la sucursal");
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("El logo debe ser PNG, JPG o WEBP");
    if (file.size > LOGO_MAX_BYTES) return toast.error("El logo no puede pesar más de 1 MB");
    setUploading(true);
    try {
      await apiUpload("/api/branding/logo", file, "PUT");
      await branding.reload();
      toast.success("Logo actualizado");
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeLogo = async () => {
    if (!confirm("¿Quitar el logo de la sucursal? Se mostrará el logo por defecto.")) return;
    try {
      await apiDelete("/api/branding/logo");
      await branding.reload();
      toast.success("Logo quitado");
    } catch (e) {
      toast.error(translateError(e));
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Marca de la sucursal" description="Nombre, datos de contacto, color y logo que ven todos los usuarios de esta sucursal." />

      <Card>
        <CardHeader>
          <CardTitle>Logo</CardTitle>
          <CardDescription>PNG, JPG o WEBP, máximo 1 MB. Se recomienda una imagen cuadrada.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <img src={branding.logo} alt="Logo actual" className="h-20 w-20 rounded-md border object-contain bg-background" />
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
          <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImageUp className="mr-1 h-4 w-4" />}
            Subir logo
          </Button>
          <Button variant="ghost" onClick={removeLogo} disabled={uploading}>
            <Trash2 className="mr-1 h-4 w-4" /> Quitar
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Datos y color</CardTitle>
          <CardDescription>El nombre aparece en el menú, el login y los reportes.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>Nombre de la sucursal</Label>
            <Input value={name} maxLength={150} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Dirección</Label>
            <Input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Teléfono</Label>
            <Input value={phone} maxLength={50} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Color principal</Label>
            <div className="flex items-center gap-2">
              <input type="color" value={HEX.test(primary) ? primary : "#0F172A"} onChange={(e) => setPrimary(e.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded border bg-background p-1" aria-label="Elegir color" />
              <Input value={primary} maxLength={7} onChange={(e) => setPrimary(e.target.value)} className="font-mono" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Vista previa</Label>
            <div className="flex items-center gap-2">
              <span className="rounded-md px-3 py-2 text-sm font-medium text-white" style={{ background: HEX.test(primary) ? primary : "#0F172A" }}>
                Botón principal
              </span>
            </div>
          </div>
          <div className="sm:col-span-2">
            <Button onClick={save} disabled={saving}>
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Guardar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
