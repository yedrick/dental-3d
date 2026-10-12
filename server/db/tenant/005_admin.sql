-- Fase 4: administración de usuarios, auditoría y reportes.

-- Versión de las sesiones del usuario: va dentro del JWT. Al cambiar la contraseña, desactivar
-- al usuario o cambiar sus roles se incrementa y todos sus tokens anteriores dejan de servir.
ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0;

-- Filtros de la vista de auditoría
ALTER TABLE audit_logs ADD KEY audit_logs_action_idx (action, `timestamp`);
