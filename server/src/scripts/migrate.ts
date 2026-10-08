// Crea las tablas y carga los datos iniciales: npm run db:migrate
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";
import { config } from "../config.js";

const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
for (const file of ["schema.sql", "seed.sql"]) {
  const sql = await readFile(new URL(`../../db/${file}`, import.meta.url), "utf8");
  await conn.query(sql);
  console.log(`✔ ${file}`);
}
await conn.end();
