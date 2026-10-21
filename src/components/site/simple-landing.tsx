import { Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { MapPin, MessageCircle, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";
import { useAuth } from "@/lib/auth";
import { DEFAULT_SITE, useSiteContent, whatsappLink } from "@/lib/site";

/**
 * Portada de una clínica cuyo plan no incluye "Página web": nombre, logo, contacto y acceso al sistema.
 * Los datos salen de la sucursal (panel → Datos) y, si los tiene, del contacto de su página web.
 */
export function SimpleLanding() {
  const branding = useBranding();
  const { user, loading } = useAuth();
  const { data } = useSiteContent();
  const site = data ?? DEFAULT_SITE;
  const phone = site.contact.phone || branding.phone || "";
  const address = site.contact.address || branding.address || "";
  useEffect(() => { document.title = branding.name; }, [branding.name]);

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 px-4">
      <div className="w-full max-w-md rounded-2xl border bg-background p-8 text-center shadow-sm">
        <img src={branding.logo} alt="" className="mx-auto h-20 w-20 rounded-xl object-contain" />
        <h1 className="mt-4 text-2xl font-bold">{branding.name}</h1>
        <p className="text-sm text-muted-foreground">Centro de radiología dental</p>
        <div className="mt-6 space-y-2 text-sm">
          {address && <p className="flex items-center justify-center gap-2"><MapPin className="h-4 w-4 text-primary" />{address}</p>}
          {phone && (
            <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className="flex items-center justify-center gap-2 hover:underline">
              <Phone className="h-4 w-4 text-primary" />{phone}
            </a>
          )}
        </div>
        <div className="mt-6 flex flex-col gap-2">
          {site.contact.whatsapp && (
            <Button asChild variant="outline">
              <a href={whatsappLink(site, true)} target="_blank" rel="noreferrer"><MessageCircle className="mr-1 h-4 w-4" /> Escribir por WhatsApp</a>
            </Button>
          )}
          <Button asChild>
            {!loading && user ? <Link to="/app">Ir al sistema</Link> : <Link to="/auth">Ingresar al sistema</Link>}
          </Button>
        </div>
      </div>
    </div>
  );
}
