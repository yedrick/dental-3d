/**
 * Dirección pública de la petición (https://imagendent.ionix.kollatech.site): cada sucursal y el
 * dominio principal usan la suya en sitemap.xml y robots.txt. Detrás de nginx el protocolo llega en
 * X-Forwarded-Proto y el dominio en Host.
 */
export function publicOrigin(request: Request) {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim() || url.protocol.replace(":", "");
  const host = request.headers.get("host") || url.host;
  // Solo letras, números, puntos, guiones y puerto: el Host no puede inyectar nada en el XML
  const safeHost = /^[a-z0-9.-]+(:\d+)?$/i.test(host) ? host.toLowerCase() : url.host;
  return `${proto === "http" ? "http" : "https"}://${safeHost}`;
}
