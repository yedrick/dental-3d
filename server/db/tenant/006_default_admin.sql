-- Cuenta por activar: el ADMIN que se crea solo al dar de alta una sucursal (seed de tenancy-node)
-- tiene una contraseña aleatoria que nadie conoce. Se entra a él desde el panel de la plataforma
-- ("Entrar como…") y la app obliga a definir email, usuario y contraseña antes de seguir.
ALTER TABLE users ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0;
