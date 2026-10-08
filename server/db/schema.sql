-- Dental-3D — esquema MySQL (Fase 1: usuarios, roles, permisos, parámetros, doctores, auditoría)
-- Equivalente a las tablas de supabase/migrations. Los IDs siguen siendo UUID (CHAR(36))
-- para poder migrar los datos existentes sin cambiar referencias.
-- Fechas: DATE (YYYY-MM-DD) y DATETIME en UTC.

SET NAMES utf8mb4;

-- ============ USERS ============
-- Reemplaza auth.users + profiles de Supabase.
CREATE TABLE IF NOT EXISTS users (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  username      VARCHAR(100) NOT NULL,
  full_name     VARCHAR(200) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  approved      TINYINT(1)   NOT NULL DEFAULT 0,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_uq (username),
  UNIQUE KEY users_email_uq (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ USER_ROLES ============
CREATE TABLE IF NOT EXISTS user_roles (
  id         CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id    CHAR(36) NOT NULL,
  role       ENUM('ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR') NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_roles_user_role_uq (user_id, role),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ PERMISSIONS ============
CREATE TABLE IF NOT EXISTS permissions (
  `key`       VARCHAR(100) NOT NULL,
  description VARCHAR(255) NOT NULL,
  category    VARCHAR(50)  NOT NULL DEFAULT 'general',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role           ENUM('ADMIN','SUBADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR') NOT NULL,
  permission_key VARCHAR(100) NOT NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role, permission_key),
  CONSTRAINT role_permissions_perm_fk FOREIGN KEY (permission_key) REFERENCES permissions(`key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ APP_PARAMS ============
CREATE TABLE IF NOT EXISTS app_params (
  `key`       VARCHAR(100)   NOT NULL,
  value_num   DECIMAL(12,4)  NULL,
  value_text  TEXT           NULL,
  value_bool  TINYINT(1)     NULL,
  description VARCHAR(255)   NOT NULL,
  updated_at  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by  CHAR(36)       NULL,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ DOCTORS ============
CREATE TABLE IF NOT EXISTS doctors (
  id                     CHAR(36)     NOT NULL DEFAULT (UUID()),
  full_name              VARCHAR(200) NOT NULL,
  clinic_address         TEXT         NULL,
  phone                  VARCHAR(50)  NULL,
  email                  VARCHAR(255) NULL,
  bank_account           VARCHAR(100) NULL,
  status                 TINYINT(1)   NOT NULL DEFAULT 1,
  use_percentage         TINYINT(1)   NOT NULL DEFAULT 0,
  default_commission_pct DECIMAL(5,2) NOT NULL DEFAULT 20,
  agreement_discount_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_by             CHAR(36)     NULL,
  created_at             DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY doctors_full_name_idx (full_name),
  CONSTRAINT doctors_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT doctors_pct_max_20 CHECK (default_commission_pct >= 0 AND default_commission_pct <= 20)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ AUDIT_LOGS ============
-- En Supabase lo llenaba un trigger con auth.uid(). MySQL no conoce al usuario de la app,
-- así que la API escribe aquí dentro de la misma transacción de cada cambio (src/lib/audit.ts).
CREATE TABLE IF NOT EXISTS audit_logs (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)     NULL,
  action     VARCHAR(50)  NOT NULL,
  table_name VARCHAR(100) NOT NULL,
  record_id  VARCHAR(100) NULL,
  data       JSON         NULL,
  `timestamp` DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY audit_logs_table_record_idx (table_name, record_id),
  KEY audit_logs_timestamp_idx (`timestamp`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
