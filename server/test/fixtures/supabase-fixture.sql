-- Datos de ejemplo con la MISMA estructura que la base de Supabase (según src/integrations/supabase/types.ts),
-- con casos difíciles para probar src/scripts/import-supabase.ts: sobrepago por convenio, saldo de caja
-- descuadrado, movimiento en cero, usuarios que chocan sin mayúsculas, usuario sin contraseña, cita inválida,
-- fecha a las 23:59:59.7 UTC y comprobantes. Contraseñas: admin Clave123!xyz, caja Caja123!xyzA, Recep Recep123!xyz.
--   docker run -d --name pgfixture -e POSTGRES_PASSWORD=pgfix -p 5433:5432 postgres:16
--   docker exec -i pgfixture psql -U postgres -v ON_ERROR_STOP=1 < test/fixtures/supabase-fixture.sql
--   SUPABASE_DB_URL=postgresql://postgres:pgfix@127.0.0.1:5433/postgres npm run tenant:import-supabase -- <sucursal> --dry-run

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, encrypted_password text, created_at timestamptz DEFAULT now());
CREATE TYPE public.app_role AS ENUM ('ADMIN','RECEPCION','CAJA','CONTABILIDAD','DOCTOR','AUDITOR','SUBADMIN');
CREATE TYPE public.payment_method AS ENUM ('cash','qr','card');
CREATE TABLE public.profiles (id uuid PRIMARY KEY, username text UNIQUE NOT NULL, full_name text NOT NULL, email text NOT NULL, active boolean NOT NULL DEFAULT true, approved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.user_roles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, role app_role NOT NULL, created_at timestamptz DEFAULT now());
CREATE TABLE public.permissions (key text PRIMARY KEY, description text NOT NULL, category text NOT NULL DEFAULT 'general', created_at timestamptz DEFAULT now());
CREATE TABLE public.role_permissions (role app_role, permission_key text, created_at timestamptz DEFAULT now(), PRIMARY KEY(role, permission_key));
CREATE TABLE public.app_params (key text PRIMARY KEY, value_num numeric(12,4), value_text text, value_bool boolean, description text NOT NULL, updated_at timestamptz DEFAULT now(), updated_by uuid);
CREATE TABLE public.doctors (id uuid PRIMARY KEY, full_name text NOT NULL, clinic_address text, phone text, email text, bank_account text, status boolean NOT NULL DEFAULT true, default_commission_pct numeric(5,2) NOT NULL DEFAULT 20, agreement_discount_pct numeric(5,2) NOT NULL DEFAULT 0, use_percentage boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.patients (id uuid PRIMARY KEY, doctor_id uuid NOT NULL, full_name text NOT NULL, birth_date date, phone text, email text, notes text, status boolean NOT NULL DEFAULT true, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.studies (id uuid PRIMARY KEY, name text NOT NULL, description text, fixed_commission numeric(12,2) NOT NULL DEFAULT 0, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.study_prices (id uuid PRIMARY KEY, study_id uuid NOT NULL, price_with_report numeric(12,2) NOT NULL, price_without_report numeric(12,2) NOT NULL, effective_date date NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.patient_studies (id uuid PRIMARY KEY, patient_id uuid NOT NULL, study_id uuid NOT NULL, price numeric(12,2) NOT NULL DEFAULT 0, has_report boolean NOT NULL DEFAULT false, payment_method payment_method, invoice_number text, delivery_date date, is_voucher boolean NOT NULL DEFAULT false, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), doctor_id uuid, clinic_name text, with_invoice boolean NOT NULL DEFAULT false, invoice_surcharge numeric(12,2) NOT NULL DEFAULT 0, discount numeric(12,2) NOT NULL DEFAULT 0, amount_paid numeric(12,2) NOT NULL DEFAULT 0, delivered_at timestamptz, delivered_by uuid);
CREATE TABLE public.commissions (id uuid PRIMARY KEY, doctor_id uuid NOT NULL, patient_study_id uuid NOT NULL, commission_amount numeric(12,2) NOT NULL, percentage numeric(5,2) NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.cashbox (id uuid PRIMARY KEY, description text NOT NULL, income numeric(12,2) NOT NULL DEFAULT 0, expense numeric(12,2) NOT NULL DEFAULT 0, balance numeric(12,2) NOT NULL DEFAULT 0, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.bank_deposits (id uuid PRIMARY KEY, amount numeric(12,2) NOT NULL, deposit_date date NOT NULL, reference text, receipt_url text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.third_party_payments (id uuid PRIMARY KEY, provider_name text NOT NULL, service_type text NOT NULL, amount numeric(12,2) NOT NULL, service_date date NOT NULL, payment_date date NOT NULL, receipt_url text, created_by uuid, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.appointments (id uuid PRIMARY KEY, patient_id uuid, patient_name text NOT NULL, patient_phone text, doctor_id uuid, study_id uuid, starts_at timestamptz NOT NULL, duration_min int NOT NULL DEFAULT 30, status text NOT NULL DEFAULT 'SCHEDULED', notes text, created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notifications (id uuid PRIMARY KEY, sender_id uuid NOT NULL, title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.notification_recipients (id uuid PRIMARY KEY, notification_id uuid NOT NULL, user_id uuid NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.audit_logs (id bigserial PRIMARY KEY, user_id uuid, action text NOT NULL, table_name text NOT NULL, record_id text, data jsonb, timestamp timestamptz NOT NULL DEFAULT now());

-- Usuarios: admin y cajera con contraseña bcrypt (como GoTrue), "Recep"/"recep" chocan sin mayúsculas, uno sin contraseña
INSERT INTO auth.users VALUES
 ('11111111-1111-4111-8111-111111111111','admin@clinica.com', crypt('Clave123!xyz', gen_salt('bf',10)), '2026-07-01 10:00:00+00'),
 ('22222222-2222-4222-8222-222222222222','caja@clinica.com', crypt('Caja123!xyzA', gen_salt('bf',10)), '2026-07-01 11:00:00+00'),
 ('33333333-3333-4333-8333-333333333333','recep1@clinica.com', crypt('Recep123!xyz', gen_salt('bf',10)), '2026-07-02 11:00:00+00'),
 ('44444444-4444-4444-8444-444444444444','recep2@clinica.com', NULL, '2026-07-03 11:00:00+00');
INSERT INTO public.profiles VALUES
 ('11111111-1111-4111-8111-111111111111','admin','Admin Clínica','admin@clinica.com',true,true,'2026-07-01 10:00:00+00'),
 ('22222222-2222-4222-8222-222222222222','caja','Cajera Uno','CAJA@clinica.com',true,true,'2026-07-01 11:00:00+00'),
 ('33333333-3333-4333-8333-333333333333','Recep','Recep Uno','recep1@clinica.com',true,true,'2026-07-02 11:00:00+00'),
 ('44444444-4444-4444-8444-444444444444','recep','Recep Dos','recep2@clinica.com',true,false,'2026-07-03 11:00:00+00');
INSERT INTO public.user_roles (user_id, role) VALUES ('11111111-1111-4111-8111-111111111111','ADMIN'),('22222222-2222-4222-8222-222222222222','CAJA'),('33333333-3333-4333-8333-333333333333','RECEPCION'),('44444444-4444-4444-8444-444444444444','RECEPCION');
INSERT INTO public.permissions (key, description, category) VALUES ('view.cashbox','Ver caja chica','vistas'),('view.reports','Ver reportes','vistas'),('cashbox.create','Registrar movimiento de caja','acciones'),('custom.legacy','Permiso solo de Supabase','general');
-- Matriz personalizada: CAJA también ve reportes
INSERT INTO public.role_permissions (role, permission_key) VALUES ('CAJA','view.cashbox'),('CAJA','cashbox.create'),('CAJA','view.reports'),('ADMIN','view.cashbox');
INSERT INTO public.app_params (key, value_num, description) VALUES ('invoice_surcharge_pct', 15, 'Recargo % cuando se emite factura'),('voucher_amount', 60, 'Monto en Bs del vale');

INSERT INTO public.doctors VALUES
 ('d1111111-1111-4111-8111-111111111111','Dr. Convenio','Av. 1','700','dc@x.com','111',true,10,10,true,'11111111-1111-4111-8111-111111111111','2026-07-05 12:00:00+00'),
 ('d2222222-2222-4222-8222-222222222222','Dra. Fija',NULL,NULL,NULL,NULL,true,0,0,false,'99999999-9999-4999-8999-999999999999','2026-07-05 12:00:00+00');
INSERT INTO public.patients VALUES
 ('a1111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','Ana Pérez','1990-05-10','7001',NULL,'alérgica',true,'33333333-3333-4333-8333-333333333333','2026-07-06 12:00:00+00'),
 ('a2222222-2222-4222-8222-222222222222','d2222222-2222-4222-8222-222222222222','Beto Rojas',NULL,NULL,NULL,NULL,true,'33333333-3333-4333-8333-333333333333','2026-07-06 12:00:00+00');
INSERT INTO public.studies VALUES
 ('51111111-1111-4111-8111-111111111111','Tomografía',NULL,30,true,'2026-07-01 00:00:00+00'),
 ('52222222-2222-4222-8222-222222222222','Panorámica',NULL,20,true,'2026-07-01 00:00:00+00');
INSERT INTO public.study_prices VALUES
 ('61111111-1111-4111-8111-111111111111','51111111-1111-4111-8111-111111111111',250,150,'2026-01-01',false,'2026-07-01 00:00:00+00'),
 ('62222222-2222-4222-8222-222222222222','51111111-1111-4111-8111-111111111111',300,200,'2026-07-01',true,'2026-07-02 00:00:00+00'),
 ('63333333-3333-4333-8333-333333333333','52222222-2222-4222-8222-222222222222',120,80,'2026-07-01',true,'2026-07-02 00:00:00+00');
-- ps1: convenio 10% → total 300+45-30=315, pero el frontend cobró 345 (sin descuento) → sobrepago 30
-- ps2: entregada por un usuario borrado; creada 23:59:59.7 UTC (no debe pasar al día siguiente)
-- ps3: vale
INSERT INTO public.patient_studies (id, patient_id, study_id, price, has_report, payment_method, is_voucher, created_by, created_at, doctor_id, with_invoice, invoice_surcharge, discount, amount_paid, delivered_at, delivered_by) VALUES
 ('71111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','51111111-1111-4111-8111-111111111111',300,true,'cash',false,'22222222-2222-4222-8222-222222222222','2026-10-01 14:00:00+00','d1111111-1111-4111-8111-111111111111',true,45,30,345,NULL,NULL),
 ('72222222-2222-4222-8222-222222222222','a2222222-2222-4222-8222-222222222222','52222222-2222-4222-8222-222222222222',80,false,'qr',false,'22222222-2222-4222-8222-222222222222','2026-10-07 23:59:59.7+00','d2222222-2222-4222-8222-222222222222',false,0,0,50,'2026-10-08 15:00:00+00','99999999-9999-4999-8999-999999999999'),
 ('73333333-3333-4333-8333-333333333333','a2222222-2222-4222-8222-222222222222','52222222-2222-4222-8222-222222222222',0,false,NULL,true,NULL,'2026-10-08 10:00:00+00','d2222222-2222-4222-8222-222222222222',false,0,0,0,NULL,NULL);
INSERT INTO public.commissions VALUES
 ('81111111-1111-4111-8111-111111111111','d1111111-1111-4111-8111-111111111111','71111111-1111-4111-8111-111111111111',150,50,'2026-10-01 14:00:00+00'),
 ('82222222-2222-4222-8222-222222222222','d2222222-2222-4222-8222-222222222222','72222222-2222-4222-8222-222222222222',20,0,'2026-10-07 23:59:59.7+00'),
 ('83333333-3333-4333-8333-333333333333','d2222222-2222-4222-8222-222222222222','73333333-3333-4333-8333-333333333333',60,0,'2026-10-08 10:00:00+00');
-- Caja: el 4º movimiento guardó saldo 80 (calculado sobre 70 por concurrencia); el real es 130. El 5º está en cero.
INSERT INTO public.cashbox VALUES
 ('91111111-1111-4111-8111-111111111111','Fondo',100,0,100,'22222222-2222-4222-8222-222222222222','2026-10-01 08:00:00+00'),
 ('92222222-2222-4222-8222-222222222222','Material',0,30,70,'22222222-2222-4222-8222-222222222222','2026-10-01 09:00:00+00'),
 ('93333333-3333-4333-8333-333333333333','Venta',50,0,120,'22222222-2222-4222-8222-222222222222','2026-10-01 10:00:00+00'),
 ('94444444-4444-4444-8444-444444444444','Venta 2',10,0,80,'22222222-2222-4222-8222-222222222222','2026-10-01 10:00:00.5+00'),
 ('95555555-5555-4555-8555-555555555555','Error',0,0,80,'22222222-2222-4222-8222-222222222222','2026-10-01 11:00:00+00');
INSERT INTO public.bank_deposits VALUES
 ('b1111111-1111-4111-8111-111111111111',1500,'2026-10-02','BNB-1','deposits/1727-abc.jpg','22222222-2222-4222-8222-222222222222','2026-10-02 12:00:00+00'),
 ('b2222222-2222-4222-8222-222222222222',0,'2026-10-03','cero',NULL,'22222222-2222-4222-8222-222222222222','2026-10-03 12:00:00+00');
INSERT INTO public.third_party_payments VALUES
 ('c1111111-1111-4111-8111-111111111111','Lab','Mantenimiento',800,'2026-09-30','2026-10-02','third/99-x.png','11111111-1111-4111-8111-111111111111','2026-10-02 13:00:00+00');
INSERT INTO public.appointments VALUES
 ('e1111111-1111-4111-8111-111111111111','a1111111-1111-4111-8111-111111111111','Ana Pérez','7001','d1111111-1111-4111-8111-111111111111','51111111-1111-4111-8111-111111111111','2026-10-20 13:30:00+00',30,'CONFIRMED',NULL,'33333333-3333-4333-8333-333333333333','2026-10-08 12:00:00+00','2026-10-08 12:00:00+00'),
 ('e2222222-2222-4222-8222-222222222222',NULL,'Walk-in',NULL,NULL,NULL,'2026-10-21 14:00:00+00',600,'RARO',NULL,'33333333-3333-4333-8333-333333333333','2026-10-08 12:00:00+00','2026-10-08 12:00:00+00');
INSERT INTO public.notifications VALUES ('f1111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111','Bienvenida','Hola equipo','2026-10-01 12:00:00+00');
INSERT INTO public.notification_recipients VALUES
 ('f2111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','2026-10-01 13:00:00+00','2026-10-01 12:00:00+00'),
 ('f3111111-1111-4111-8111-111111111111','f1111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',NULL,'2026-10-01 12:00:00+00');
INSERT INTO public.audit_logs (user_id, action, table_name, record_id, data, timestamp) VALUES
 ('11111111-1111-4111-8111-111111111111','INSERT','doctors','d1111111-1111-4111-8111-111111111111','{"full_name":"Dr. Convenio"}','2026-07-05 12:00:00+00'),
 ('22222222-2222-4222-8222-222222222222','CHARGE','patient_studies','71111111-1111-4111-8111-111111111111','{"amount":345}','2026-10-01 14:00:00+00'),
 (NULL,'UPDATE','patients','a1111111-1111-4111-8111-111111111111',NULL,'2026-10-02 14:00:00+00');
