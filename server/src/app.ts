import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db.js";
import { errorHandler, notFound } from "./middleware/error.js";
import { authRouter } from "./routes/auth.routes.js";
import { doctorsRouter } from "./routes/doctors.routes.js";

export const app = express();

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.use("/api/auth", authRouter);
app.use("/api/doctors", doctorsRouter);

app.use(notFound);
app.use(errorHandler);
