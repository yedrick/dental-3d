# Reglas para agentes

- **No reescribir el historial ya subido** (nada de `push --force`, ni rebase, amend o squash de
  commits publicados). Mientras el repositorio siga conectado a Lovable (hasta el paso 4 de
  `server/PLAN.md`, Fase 6.2), reescribir `main` también borra el historial del lado de Lovable.
- Subir a la rama conectada (`main`) solo cambios que funcionen: lo que se sube llega a Lovable.
- Trabajar en `dev`. No subir `.env` ni las carpetas `storage/` y `storage-private/`.
- Antes de un commit: `npx tsc --noEmit` en la raíz y en `server/`, y `cd server && npm test`.
