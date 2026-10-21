-- Fase 3: caja chica, depósitos, pagos a terceros, agenda de citas y notificaciones.

-- ============ CASHBOX (caja chica) ============
-- Libro de movimientos: no se editan ni se borran; una corrección es un movimiento nuevo.
-- seq da el orden exacto de registro (created_at puede repetirse en el mismo segundo).
CREATE TABLE IF NOT EXISTS cashbox (
  id          CHAR(36)        NOT NULL DEFAULT (UUID()),
  seq         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  description VARCHAR(500)    NOT NULL,
  income      DECIMAL(12,2)   NOT NULL DEFAULT 0,
  expense     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  balance     DECIMAL(12,2)   NOT NULL,
  created_by  CHAR(36)        NULL,
  created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY cashbox_seq_uq (seq),
  KEY cashbox_created_at_idx (created_at),
  CONSTRAINT cashbox_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT cashbox_amounts_chk CHECK (income >= 0 AND expense >= 0 AND (income > 0 OR expense > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saldo actual de la caja en UNA fila. Cada movimiento la bloquea (FOR UPDATE), así dos
-- movimientos simultáneos se aplican uno tras otro: balance = saldo anterior + ingreso − gasto.
-- (En Supabase el trigger leía "la última fila" sin bloqueo y podía calcular mal el saldo.)
CREATE TABLE IF NOT EXISTS cashbox_state (
  id         TINYINT       NOT NULL,
  balance    DECIMAL(12,2) NOT NULL DEFAULT 0,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  CONSTRAINT cashbox_state_single_chk CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO cashbox_state (id, balance) VALUES (1, 0);

-- ============ BANK_DEPOSITS ============
-- receipt_url guarda la ruta del comprobante en el almacenamiento PRIVADO (mismo nombre que en Supabase).
CREATE TABLE IF NOT EXISTS bank_deposits (
  id           CHAR(36)      NOT NULL DEFAULT (UUID()),
  amount       DECIMAL(12,2) NOT NULL,
  deposit_date DATE          NOT NULL,
  reference    VARCHAR(200)  NULL,
  receipt_url  VARCHAR(300)  NULL,
  created_by   CHAR(36)      NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY bank_deposits_date_idx (deposit_date),
  CONSTRAINT bank_deposits_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT bank_deposits_amount_chk CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ THIRD_PARTY_PAYMENTS ============
-- Regla: service_date no se puede cambiar después de guardar (lo controla la API).
CREATE TABLE IF NOT EXISTS third_party_payments (
  id            CHAR(36)      NOT NULL DEFAULT (UUID()),
  provider_name VARCHAR(200)  NOT NULL,
  service_type  VARCHAR(200)  NOT NULL,
  amount        DECIMAL(12,2) NOT NULL,
  service_date  DATE          NOT NULL,
  payment_date  DATE          NOT NULL,
  receipt_url   VARCHAR(300)  NULL,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY third_party_payment_date_idx (payment_date),
  KEY third_party_provider_idx (provider_name),
  CONSTRAINT third_party_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT third_party_amount_chk CHECK (amount > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ APPOINTMENTS (agenda) ============
-- starts_at en UTC. patient_id es opcional: se puede agendar a alguien que aún no es paciente.
CREATE TABLE IF NOT EXISTS appointments (
  id            CHAR(36)     NOT NULL DEFAULT (UUID()),
  patient_id    CHAR(36)     NULL,
  patient_name  VARCHAR(200) NOT NULL,
  patient_phone VARCHAR(50)  NULL,
  doctor_id     CHAR(36)     NULL,
  study_id      CHAR(36)     NULL,
  starts_at     DATETIME     NOT NULL,
  duration_min  SMALLINT     NOT NULL DEFAULT 30,
  status        ENUM('SCHEDULED','CONFIRMED','DONE','CANCELLED','NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
  notes         TEXT         NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY appointments_starts_at_idx (starts_at),
  KEY appointments_patient_idx (patient_id),
  KEY appointments_doctor_idx (doctor_id, starts_at),
  CONSTRAINT appointments_patient_fk FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  CONSTRAINT appointments_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL,
  CONSTRAINT appointments_study_fk FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL,
  CONSTRAINT appointments_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT appointments_duration_chk CHECK (duration_min BETWEEN 5 AND 480)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ NOTIFICATIONS ============
CREATE TABLE IF NOT EXISTS notifications (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  sender_id  CHAR(36)     NOT NULL,
  title      VARCHAR(200) NOT NULL,
  body       TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY notifications_sender_idx (sender_id, created_at),
  CONSTRAINT notifications_sender_fk FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notification_recipients (
  id              CHAR(36) NOT NULL DEFAULT (UUID()),
  notification_id CHAR(36) NOT NULL,
  user_id         CHAR(36) NOT NULL,
  read_at         DATETIME NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY notification_recipients_uq (notification_id, user_id),
  KEY notification_recipients_user_idx (user_id, read_at),
  KEY notification_recipients_user_created_idx (user_id, created_at),
  CONSTRAINT notification_recipients_notification_fk FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE CASCADE,
  CONSTRAINT notification_recipients_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ PARÁMETROS NUEVOS ============
INSERT IGNORE INTO app_params (`key`, value_bool, description) VALUES
  ('cashbox_allow_negative', 0, 'Permitir que un gasto deje la caja chica en negativo');
