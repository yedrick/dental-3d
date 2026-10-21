import { SearchX } from "lucide-react";
import { platformUrl } from "@/lib/plan";

/** Subdominio que no corresponde a ninguna clínica (TENANCY_TENANT_NOT_FOUND). */
export function TenantNotFound() {
  return (
    <div className="grid min-h-screen place-items-center bg-[#070b1d] px-4 text-center text-white">
      <div>
        <SearchX className="mx-auto h-12 w-12 text-cyan-300" />
        <h1 className="mt-4 text-2xl font-bold">Esta clínica no existe</h1>
        <p className="mt-2 text-white/60">Revisa la dirección. Si es tu clínica, comunícate con IONIX.</p>
        <a href={platformUrl()} className="mt-6 inline-block rounded-xl bg-white px-5 py-3 text-sm font-semibold text-[#070b1d]">Ir a IONIX</a>
      </div>
    </div>
  );
}
