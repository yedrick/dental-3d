-- Página web pública de la sucursal (calacoto.dominio.com): títulos, textos, teléfonos, WhatsApp,
-- horarios, redes e imagen principal. Un solo documento JSON por sucursal, en SU base.
-- La API lo cachea por sucursal (tenancy.cache(), Redis en producción) y lo borra de la caché al guardar.
CREATE TABLE IF NOT EXISTS site_content (
  id         TINYINT  NOT NULL,
  content    JSON     NOT NULL,
  updated_by CHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT site_content_single_chk CHECK (id = 1),
  CONSTRAINT site_content_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO permissions (`key`, description, category) VALUES
  ('site.edit', 'Editar la página web pública de la sucursal', 'admin');
