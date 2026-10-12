-- Recuperar la contraseña con un código por correo (6 dígitos, 15 minutos, un solo uso, 5 intentos).
-- Se guarda solo el HMAC del código, nunca el código. Pedir uno nuevo anula los anteriores.
CREATE TABLE IF NOT EXISTS password_resets (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)     NOT NULL,
  code_hash  CHAR(64)     NOT NULL,
  expires_at DATETIME     NOT NULL,
  attempts   TINYINT      NOT NULL DEFAULT 0,
  used_at    DATETIME     NULL,
  ip         VARCHAR(64)  NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY password_resets_user_idx (user_id, created_at),
  CONSTRAINT password_resets_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
