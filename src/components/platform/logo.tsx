/** Logo de texto de IONIX (se puede cambiar por el logo definitivo). */
export function IonixLogo({ className = "", logoUrl, name = "IONIX" }: { className?: string; logoUrl?: string | null; name?: string }) {
  // Logo subido en el panel (/admin → Plataforma)
  if (logoUrl) return <img src={logoUrl} alt={name} className={`h-9 w-auto max-w-[180px] object-contain ${className}`} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden>
        <defs>
          <linearGradient id="ionix-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#67e8f9" />
            <stop offset="1" stopColor="#818cf8" />
          </linearGradient>
        </defs>
        <circle cx="16" cy="16" r="5" fill="url(#ionix-g)" />
        <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="url(#ionix-g)" strokeWidth="1.6" opacity=".9" />
        <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="url(#ionix-g)" strokeWidth="1.6" opacity=".6" transform="rotate(60 16 16)" />
        <ellipse cx="16" cy="16" rx="14" ry="6" fill="none" stroke="url(#ionix-g)" strokeWidth="1.6" opacity=".6" transform="rotate(120 16 16)" />
      </svg>
      <span className="font-display text-xl font-bold tracking-[0.18em]">{name.toUpperCase()}</span>
    </span>
  );
}
