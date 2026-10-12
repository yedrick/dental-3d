-- El doctor del paciente pasa a ser opcional: un paciente nuevo puede llegar sin doctor.
-- Sus atenciones se registran sin comisión ni descuento por convenio (patient_studies.doctor_id ya era NULL).
-- La llave foránea se mantiene: si tiene doctor, tiene que existir.
ALTER TABLE patients MODIFY doctor_id CHAR(36) NULL;
