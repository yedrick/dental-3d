// Variables falsas para que src/config.ts cargue sin el .env real.
// Ninguna prueba unitaria se conecta: si algo intentara usar DATABASE_URL, fallaría (puerto 1).
process.env.DATABASE_URL = "mysql://prueba:prueba@127.0.0.1:1/prueba";
process.env.TENANCY_KEY = "0".repeat(64);
process.env.JWT_SECRET = "secreto-de-pruebas-unitarias-de-32-caracteres-o-mas";
process.env.BUSINESS_UTC_OFFSET = "-04:00";
process.env.TENANCY_ADMIN_SECRET = "";
process.env.REDIS_URL = "";
process.env.PRIVATE_STORAGE_DIR = "/nonexistent/dental-3d-pruebas";
