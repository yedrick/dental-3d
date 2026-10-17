-- 1) PAGOS: una fila por cada cobro, con su fecha y su método.
--    "Cobrado hoy" pasa a contar lo que se pagó HOY, aunque la atención sea de otro día.
--    patient_studies.amount_paid se mantiene como total pagado (suma de sus pagos), para no
--    recalcular en cada lista.
CREATE TABLE IF NOT EXISTS payments (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  patient_study_id CHAR(36)      NOT NULL,
  amount           DECIMAL(12,2) NOT NULL,
  method           ENUM('cash','qr','card') NOT NULL,
  paid_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- registro = al registrar la atención · cobro = cobro de saldo · cobrar_todo · migracion
  source           VARCHAR(20)   NOT NULL,
  created_by       CHAR(36)      NULL,
  PRIMARY KEY (id),
  KEY payments_paid_at_idx (paid_at),
  KEY payments_patient_study_idx (patient_study_id, paid_at),
  CONSTRAINT payments_amount_chk CHECK (amount > 0),
  CONSTRAINT payments_patient_study_fk FOREIGN KEY (patient_study_id) REFERENCES patient_studies(id) ON DELETE CASCADE,
  CONSTRAINT payments_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historia de pagos desde la auditoría (cada cobro quedó registrado con su fecha):
-- a) lo pagado al registrar la atención
INSERT INTO payments (patient_study_id, amount, method, paid_at, source, created_by)
SELECT ps.id, CAST(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.amount_paid')) AS DECIMAL(12,2)),
       -- el método original está en el resumen de la atención (ATTENTION_CREATE): payment_method de
       -- patient_studies pudo cambiar después con un cobro
       COALESCE((SELECT NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.data, '$.payment_method')), 'null') FROM audit_logs c
                  WHERE c.table_name = 'patient_studies' AND c.record_id = ps.patient_id AND c.action = 'ATTENTION_CREATE'
                    AND JSON_CONTAINS(JSON_EXTRACT(c.data, '$.inserted_ids'), JSON_QUOTE(ps.id)) LIMIT 1),
                ps.payment_method, 'cash'),
       a.`timestamp`, 'registro', a.user_id
  FROM audit_logs a JOIN patient_studies ps ON ps.id = a.record_id
 WHERE a.action = 'INSERT' AND a.table_name = 'patient_studies'
   AND CAST(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.amount_paid')) AS DECIMAL(12,2)) > 0;

-- b) cada cobro de saldo, con su método si se indicó
INSERT INTO payments (patient_study_id, amount, method, paid_at, source, created_by)
SELECT ps.id, CAST(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.amount')) AS DECIMAL(12,2)),
       COALESCE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.payment_method')), 'null'), ps.payment_method, 'cash'),
       a.`timestamp`, 'cobro', a.user_id
  FROM audit_logs a JOIN patient_studies ps ON ps.id = a.record_id
 WHERE a.action = 'CHARGE' AND a.table_name = 'patient_studies'
   AND CAST(JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.amount')) AS DECIMAL(12,2)) > 0;

-- c) lo que falte (cobrar todo, datos copiados de Supabase): a la fecha del "cobrar todo" que
--    incluyó esa atención, o si no hay, a la fecha de la atención
INSERT INTO payments (patient_study_id, amount, method, paid_at, source, created_by)
SELECT ps.id,
       ps.amount_paid - COALESCE((SELECT SUM(x.amount) FROM payments x WHERE x.patient_study_id = ps.id), 0),
       COALESCE(ps.payment_method, 'cash'),
       COALESCE((SELECT MAX(a.`timestamp`) FROM audit_logs a
                  WHERE a.table_name = 'patient_studies' AND a.record_id = ps.patient_id AND a.action = 'CHARGE_ALL'
                    AND JSON_CONTAINS(JSON_EXTRACT(a.data, '$.ids'), JSON_QUOTE(ps.id))), ps.created_at),
       'migracion', NULL
  FROM patient_studies ps
 WHERE ps.amount_paid > COALESCE((SELECT SUM(x.amount) FROM payments x WHERE x.patient_study_id = ps.id), 0);

-- 2) USUARIO ↔ DOCTOR: un usuario con rol DOCTOR ve solo lo de su ficha de doctor
ALTER TABLE users
  ADD COLUMN doctor_id CHAR(36) NULL,
  ADD UNIQUE KEY users_doctor_uq (doctor_id),
  ADD CONSTRAINT users_doctor_fk FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE SET NULL;

-- (El DOCTOR ve sus atenciones desde sus pacientes y sus comisiones: no necesita "ver atenciones",
-- que abre la pantalla de registro.)

-- 3) DOCTOR NO REGISTRADO: en la atención se escribe su nombre y su comisión (% o monto fijo)
ALTER TABLE patient_studies ADD COLUMN external_doctor_name VARCHAR(200) NULL AFTER doctor_id;
ALTER TABLE commissions
  MODIFY doctor_id CHAR(36) NULL,
  ADD COLUMN external_doctor_name VARCHAR(200) NULL AFTER doctor_id,
  ADD KEY commissions_external_idx (external_doctor_name, created_at),
  ADD CONSTRAINT commissions_doctor_or_external_chk CHECK (doctor_id IS NOT NULL OR external_doctor_name IS NOT NULL);
