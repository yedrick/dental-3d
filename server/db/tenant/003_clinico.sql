-- Fase 2: núcleo clínico (pacientes, estudios, tarifas, atenciones y comisiones).
-- Las reglas que en Supabase eran triggers (precio, tarifa activa, comisión) ahora las
-- aplica la API dentro de transacciones: src/services/attentions.ts y src/routes/studies.routes.ts.

-- ============ PATIENTS ============
CREATE TABLE IF NOT EXISTS patients (
  id         CHAR(36)     NOT NULL DEFAULT (UUID()),
  doctor_id  CHAR(36)     NOT NULL,
  full_name  VARCHAR(200) NOT NULL,
  birth_date DATE         NULL,
  phone      VARCHAR(50)  NULL,
  email      VARCHAR(255) NULL,
  notes      TEXT         NULL,
  status     TINYINT(1)   NOT NULL DEFAULT 1,
  created_by CHAR(36)     NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY patients_full_name_idx (full_name),
  KEY patients_doctor_idx (doctor_id),
  KEY patients_phone_idx (phone),
  KEY patients_created_at_idx (created_at),
  CONSTRAINT patients_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT patients_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ STUDIES ============
CREATE TABLE IF NOT EXISTS studies (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  name             VARCHAR(200)  NOT NULL,
  description      TEXT          NULL,
  fixed_commission DECIMAL(12,2) NOT NULL DEFAULT 0,
  active           TINYINT(1)    NOT NULL DEFAULT 1,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY studies_name_idx (name),
  CONSTRAINT studies_fixed_commission_chk CHECK (fixed_commission >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ STUDY_PRICES ============
-- Regla crítica: una sola tarifa activa por estudio. En PostgreSQL era un índice único parcial
-- (WHERE is_active); MySQL no los tiene, así que se usa una columna generada que solo vale
-- study_id cuando la tarifa está activa (los NULL no chocan en un índice único).
-- MySQL no permite ON DELETE CASCADE en la base de una columna generada: al borrar un
-- estudio, la API borra sus tarifas en la misma transacción.
CREATE TABLE IF NOT EXISTS study_prices (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  study_id             CHAR(36)      NOT NULL,
  price_with_report    DECIMAL(12,2) NOT NULL,
  price_without_report DECIMAL(12,2) NOT NULL,
  effective_date       DATE          NOT NULL,
  is_active            TINYINT(1)    NOT NULL DEFAULT 1,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- RTRIM: MariaDB no deja indexar una columna calculada que use un CHAR tal cual (su valor depende
  -- del modo PAD_CHAR_TO_FULL_LENGTH). En un UUID no cambia nada; MySQL 8 y MariaDB 10.6+ lo aceptan.
  active_study_id      CHAR(36) AS (IF(is_active = 1, RTRIM(study_id), NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY study_prices_one_active (active_study_id),
  KEY study_prices_study_idx (study_id, is_active),
  CONSTRAINT study_prices_study_fk FOREIGN KEY (study_id) REFERENCES studies(id),
  CONSTRAINT study_prices_positive_chk CHECK (price_with_report >= 0 AND price_without_report >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ PATIENT_STUDIES (atenciones) ============
-- total = price + invoice_surcharge - discount ; saldo = total - amount_paid
CREATE TABLE IF NOT EXISTS patient_studies (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  patient_id        CHAR(36)      NOT NULL,
  study_id          CHAR(36)      NOT NULL,
  doctor_id         CHAR(36)      NULL,
  clinic_name       VARCHAR(200)  NULL,
  price             DECIMAL(12,2) NOT NULL DEFAULT 0,
  has_report        TINYINT(1)    NOT NULL DEFAULT 0,
  is_voucher        TINYINT(1)    NOT NULL DEFAULT 0,
  with_invoice      TINYINT(1)    NOT NULL DEFAULT 0,
  invoice_number    VARCHAR(100)  NULL,
  invoice_surcharge DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_paid       DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method    ENUM('cash','qr','card') NULL,
  delivery_date     DATE          NULL,
  delivered_at      DATETIME      NULL,
  delivered_by      CHAR(36)      NULL,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY patient_studies_patient_idx (patient_id, created_at),
  KEY patient_studies_created_at_idx (created_at),
  KEY patient_studies_doctor_idx (doctor_id, created_at),
  KEY patient_studies_study_idx (study_id),
  KEY patient_studies_delivered_idx (delivered_at),
  CONSTRAINT patient_studies_patient_fk FOREIGN KEY (patient_id) REFERENCES patients(id),
  CONSTRAINT patient_studies_study_fk FOREIGN KEY (study_id) REFERENCES studies(id),
  CONSTRAINT patient_studies_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT patient_studies_delivered_by_fk FOREIGN KEY (delivered_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT patient_studies_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT patient_studies_amounts_chk CHECK (price >= 0 AND invoice_surcharge >= 0 AND discount >= 0 AND amount_paid >= 0),
  CONSTRAINT patient_studies_not_overpaid_chk CHECK (amount_paid <= price + invoice_surcharge - discount)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ COMMISSIONS ============
CREATE TABLE IF NOT EXISTS commissions (
  id                CHAR(36)      NOT NULL DEFAULT (UUID()),
  doctor_id         CHAR(36)      NOT NULL,
  patient_study_id  CHAR(36)      NOT NULL,
  commission_amount DECIMAL(12,2) NOT NULL,
  percentage        DECIMAL(5,2)  NOT NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY commissions_patient_study_uq (patient_study_id),
  KEY commissions_doctor_idx (doctor_id, created_at),
  KEY commissions_created_at_idx (created_at),
  CONSTRAINT commissions_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id),
  CONSTRAINT commissions_patient_study_fk FOREIGN KEY (patient_study_id) REFERENCES patient_studies(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
