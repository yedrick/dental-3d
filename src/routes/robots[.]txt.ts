import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { publicOrigin } from "@/lib/public-origin";

// robots.txt con el sitemap del dominio que se visita (cada sucursal tiene el suyo)
export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: async ({ request }) =>
        new Response(
          ["User-agent: *", "Allow: /", "Disallow: /app/", "Disallow: /auth", "Disallow: /admin/", "", `Sitemap: ${publicOrigin(request)}/sitemap.xml`, ""].join("\n"),
          { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } },
        ),
    },
  },
});
