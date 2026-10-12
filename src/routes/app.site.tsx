import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPut, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { STALE } from "@/lib/query-config";
import type { SiteContent } from "@/lib/site";
import { translateError } from "@/lib/translate-error";
import { formatDateTime } from "@/lib/data";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, ImageUp, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/site")({ component: SitePage });

const IMAGE_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Página web pública de la sucursal (permiso site.edit): títulos, textos, teléfonos, WhatsApp,
 * horarios, redes e imagen principal. Se guarda en la base de esta sucursal y se ve al instante
 * en la portada (https://<sucursal>.dominio.com).
 */
function SitePage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["site-admin"],
    queryFn: () => apiGet<{ content: SiteContent; updated_at: string | null }>("/api/site"),
    staleTime: STALE.catalog,
    enabled: can("site.edit"),
  });
  const [site, setSite] = useState<SiteContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (data) setSite(structuredClone(data.content)); }, [data]);

  if (!can("site.edit")) return <div className="p-6 text-sm text-muted-foreground">No tienes permiso para editar la página web.</div>;
  if (isLoading || !site) return <div className="grid place-items-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  // Actualiza un campo de una sección: set("hero", "title", "…")
  const set = <S extends keyof SiteContent>(section: S, field: string, value: string) =>
    setSite((s) => (s ? { ...s, [section]: { ...(s[section] as object), [field]: value } } : s));

  const save = async () => {
    setSaving(true);
    try {
      await apiPut("/api/site", site);
      await Promise.all([qc.invalidateQueries({ queryKey: ["site-admin"] }), qc.invalidateQueries({ queryKey: ["public-site"] })]);
      toast.success("Página web actualizada");
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    if (!confirm("¿Volver a los textos por defecto? Se perderán los cambios guardados de la página web.")) return;
    try {
      const fresh = await apiDelete<SiteContent>("/api/site");
      if (fresh) setSite(fresh);
      await Promise.all([qc.invalidateQueries({ queryKey: ["site-admin"] }), qc.invalidateQueries({ queryKey: ["public-site"] })]);
      toast.success("Se restablecieron los textos por defecto");
    } catch (e) {
      toast.error(translateError(e));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) return toast.error("La imagen debe ser PNG, JPG o WEBP");
    if (file.size > IMAGE_MAX_BYTES) return toast.error("La imagen no puede pesar más de 2 MB");
    setUploading(true);
    try {
      const { key, url } = await apiUpload<{ key: string; url: string }>("/api/site/images", file);
      setSite((s) => (s ? { ...s, hero: { ...s.hero, image: key, image_url: url } } : s));
      toast.success("Imagen subida. Guarda para publicarla.");
    } catch (e) {
      toast.error(translateError(e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-24">
      <PageHeader
        title="Página web"
        description={`Lo que ven los pacientes en la portada de esta sucursal.${data?.updated_at ? ` Última actualización: ${formatDateTime(data.updated_at)}.` : ""}`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" asChild><a href="/" target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />Ver página</a></Button>
            <Button variant="ghost" onClick={reset}><RotateCcw className="mr-1 h-4 w-4" />Restablecer</Button>
          </div>
        }
      />

      <Section title="Portada" description="Primer bloque de la página.">
        <F label="Etiqueta superior" span><Input value={site.hero.badge} maxLength={80} onChange={(e) => set("hero", "badge", e.target.value)} /></F>
        <F label="Título"><Input value={site.hero.title} maxLength={120} onChange={(e) => set("hero", "title", e.target.value)} /></F>
        <F label="Título resaltado (en color)"><Input value={site.hero.highlight} maxLength={120} onChange={(e) => set("hero", "highlight", e.target.value)} /></F>
        <F label="Texto" span><Textarea rows={3} value={site.hero.subtitle} maxLength={500} onChange={(e) => set("hero", "subtitle", e.target.value)} /></F>
        <F label="Texto del botón de WhatsApp"><Input value={site.hero.cta_label} maxLength={60} onChange={(e) => set("hero", "cta_label", e.target.value)} /></F>
        <F label="Imagen principal (si no hay, se muestra el logo)">
          <div className="flex items-center gap-3">
            {site.hero.image_url
              ? <img src={site.hero.image_url} alt="" className="h-14 w-14 rounded-md border object-cover" />
              : <div className="grid h-14 w-14 place-items-center rounded-md border text-[10px] text-muted-foreground">Logo</div>}
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              {uploading ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ImageUp className="mr-1 h-4 w-4" />}Subir
            </Button>
            {site.hero.image && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setSite((s) => (s ? { ...s, hero: { ...s.hero, image: "", image_url: "" } } : s))}>Quitar</Button>
            )}
          </div>
        </F>
      </Section>

      <Section title="Cifras destacadas" description="Hasta 4 recuadros bajo el texto de portada.">
        <div className="space-y-2 sm:col-span-2">
          {site.stats.map((st, i) => (
            <div key={i} className="flex gap-2">
              <Input className="w-28" value={st.value} maxLength={12} placeholder="10+" onChange={(e) => setSite({ ...site, stats: site.stats.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
              <Input value={st.label} maxLength={40} placeholder="Años de experiencia" onChange={(e) => setSite({ ...site, stats: site.stats.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar" onClick={() => setSite({ ...site, stats: site.stats.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {site.stats.length < 4 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSite({ ...site, stats: [...site.stats, { value: "", label: "" }] })}><Plus className="mr-1 h-4 w-4" />Agregar cifra</Button>
          )}
        </div>
      </Section>

      <Section title="Estudios" description="La lista de estudios sale sola del catálogo activo de esta sucursal.">
        <F label="Título"><Input value={site.studies.title} maxLength={120} onChange={(e) => set("studies", "title", e.target.value)} /></F>
        <F label="Texto si no hay estudios"><Input value={site.studies.empty} maxLength={200} onChange={(e) => set("studies", "empty", e.target.value)} /></F>
        <F label="Texto" span><Textarea rows={2} value={site.studies.subtitle} maxLength={300} onChange={(e) => set("studies", "subtitle", e.target.value)} /></F>
      </Section>

      <Section title="Contacto y ubicación">
        <F label="Teléfono"><Input value={site.contact.phone} maxLength={30} placeholder="77726685" onChange={(e) => set("contact", "phone", e.target.value)} /></F>
        <F label="WhatsApp (con código de país, solo números)"><Input value={site.contact.whatsapp} maxLength={15} placeholder="59177726685" inputMode="numeric" onChange={(e) => set("contact", "whatsapp", e.target.value.replace(/\D/g, ""))} /></F>
        <F label="Mensaje inicial de WhatsApp" span><Input value={site.contact.whatsapp_message} maxLength={200} onChange={(e) => set("contact", "whatsapp_message", e.target.value)} /></F>
        <F label="Email"><Input type="email" value={site.contact.email} onChange={(e) => set("contact", "email", e.target.value)} /></F>
        <F label="Enlace de Google Maps (https://…)"><Input value={site.contact.map_url} onChange={(e) => set("contact", "map_url", e.target.value)} /></F>
        <F label="Dirección"><Input value={site.contact.address} maxLength={200} onChange={(e) => set("contact", "address", e.target.value)} /></F>
        <F label="Nota de la dirección"><Input value={site.contact.address_note} maxLength={200} onChange={(e) => set("contact", "address_note", e.target.value)} /></F>
      </Section>

      <Section title="Horarios de atención" description="Hasta 7 filas.">
        <div className="space-y-2 sm:col-span-2">
          {site.hours.map((h, i) => (
            <div key={i} className="flex gap-2">
              <Input value={h.day} maxLength={40} placeholder="Lunes a Viernes" onChange={(e) => setSite({ ...site, hours: site.hours.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)) })} />
              <Input value={h.hours} maxLength={40} placeholder="08:00 – 19:00" onChange={(e) => setSite({ ...site, hours: site.hours.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)) })} />
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar" onClick={() => setSite({ ...site, hours: site.hours.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          {site.hours.length < 7 && (
            <Button type="button" variant="outline" size="sm" onClick={() => setSite({ ...site, hours: [...site.hours, { day: "", hours: "" }] })}><Plus className="mr-1 h-4 w-4" />Agregar horario</Button>
          )}
        </div>
      </Section>

      <Section title="Redes sociales" description="Enlaces https:// (vacío = no se muestra).">
        <F label="Facebook"><Input value={site.social.facebook} onChange={(e) => set("social", "facebook", e.target.value)} /></F>
        <F label="Instagram"><Input value={site.social.instagram} onChange={(e) => set("social", "instagram", e.target.value)} /></F>
        <F label="TikTok"><Input value={site.social.tiktok} onChange={(e) => set("social", "tiktok", e.target.value)} /></F>
      </Section>

      <Section title="Llamado final y pie de página">
        <F label="Título del llamado"><Input value={site.cta.title} maxLength={120} onChange={(e) => set("cta", "title", e.target.value)} /></F>
        <F label="Nombre en el pie de página"><Input value={site.footer.name} maxLength={100} onChange={(e) => set("footer", "name", e.target.value)} /></F>
        <F label="Texto del llamado" span><Textarea rows={2} value={site.cta.subtitle} maxLength={300} onChange={(e) => set("cta", "subtitle", e.target.value)} /></F>
      </Section>

      <Section title="Buscadores (SEO)" description="Título de la pestaña y descripción que muestran Google y WhatsApp al compartir.">
        <F label="Título" span><Input value={site.seo.title} maxLength={120} onChange={(e) => set("seo", "title", e.target.value)} /></F>
        <F label="Descripción" span><Textarea rows={2} value={site.seo.description} maxLength={300} onChange={(e) => set("seo", "description", e.target.value)} /></F>
      </Section>

      <div className="fixed bottom-4 right-4 z-40">
        <Button size="lg" onClick={save} disabled={saving} className="shadow-lg">
          {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Guardar página web
        </Button>
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">{children}</CardContent>
    </Card>
  );
}

// <label> envuelve el campo: el texto queda asociado (lectores de pantalla, clic en la etiqueta)
function F({ label, span, children }: { label: string; span?: boolean; children: ReactNode }) {
  return (
    <label className={`block space-y-1.5 ${span ? "sm:col-span-2" : ""}`}>
      <span className="text-sm font-medium leading-none">{label}</span>
      {children}
    </label>
  );
}
