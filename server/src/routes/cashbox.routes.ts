import { Router } from "express";
import { z } from "zod";
import { db, withTransaction } from "../db.js";
import { audit } from "../lib/audit.js";
import { HttpError } from "../lib/http-error.js";
import { fromCents, toCents } from "../lib/money.js";
import { dateRangeSchema, dayRange, paged, paginate, paginationSchema } from "../lib/query.js";
import { money } from "../lib/schemas.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

// Caja chica: libro de movimientos. No se editan ni se borran (una corrección es un
// movimiento nuevo). Sin caché: es dinero.
export const cashboxRouter = Router();
cashboxRouter.use(requireAuth);

const movementSchema = z
  .object({
    description: z.string().trim().min(1, "Descripción requerida").max(500),
    income: money.default(0),
    expense: money.default(0),
  })
  .refine((m) => (m.income > 0) !== (m.expense > 0), {
    message: "Registra un ingreso o un gasto (uno de los dos, mayor a 0)",
    path: ["income"],
  });

const listSchema = paginationSchema.and(dateRangeSchema);

async function currentBalance() {
  const [state] = await db().query<{ balance: number }[]>("SELECT balance FROM cashbox_state WHERE id = 1");
  return Number(state?.balance ?? 0);
}

cashboxRouter.get("/", requirePermission("view.cashbox"), async (req, res) => {
  const f = listSchema.parse(req.query);
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.from || f.to) {
    const [start, end] = dayRange(f.from ?? "2000-01-01", f.to ?? "2999-12-31");
    where.push("c.created_at >= ? AND c.created_at < ?");
    params.push(start, end);
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
  const { limit, offset } = paginate(f.page, f.limit);
  const [rows, [sum], balance] = await Promise.all([
    db().query(
      `SELECT c.id, c.description, c.income, c.expense, c.balance, c.created_by, u.full_name AS created_by_name, c.created_at
         FROM cashbox c LEFT JOIN users u ON u.id = c.created_by
         ${whereSql} ORDER BY c.seq DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    ),
    db().query<{ count: number; income: number | null; expense: number | null }[]>(
      `SELECT COUNT(*) AS count, SUM(income) AS income, SUM(expense) AS expense FROM cashbox c ${whereSql}`,
      params,
    ),
    currentBalance(),
  ]);
  res.json({
    ...paged(rows, Number(sum.count), f.page, f.limit),
    summary: { income: Number(sum.income ?? 0), expense: Number(sum.expense ?? 0), balance },
  });
});

/** Saldo actual (para el dashboard). */
cashboxRouter.get("/balance", requirePermission("view.cashbox", "view.dashboard"), async (_req, res) => {
  res.json({ balance: await currentBalance() });
});

/** Registra un ingreso o un gasto. balance = saldo anterior + ingreso − gasto (antes trigger set_cashbox_balance). */
cashboxRouter.post("/", requirePermission("cashbox.create"), async (req, res) => {
  const data = movementSchema.parse(req.body);
  const movement = await withTransaction(async (tx) => {
    // Bloquea la fila del saldo: los movimientos simultáneos se aplican uno tras otro
    const [state] = await tx.query<{ balance: number }[]>("SELECT balance FROM cashbox_state WHERE id = 1 FOR UPDATE");
    if (!state) throw new HttpError(500, "Falta la fila de saldo de caja (cashbox_state)");
    const [param] = await tx.query<{ value_bool: boolean | null }[]>(
      "SELECT value_bool FROM app_params WHERE `key` = 'cashbox_allow_negative'",
    );

    const balanceCents = toCents(state.balance) + toCents(data.income) - toCents(data.expense);
    if (balanceCents < 0 && !param?.value_bool) {
      throw new HttpError(400, `Saldo insuficiente en caja chica: hay ${fromCents(toCents(state.balance))} Bs`, "INSUFFICIENT_BALANCE");
    }
    const balance = fromCents(balanceCents);
    const [{ id }] = await tx.query<{ id: string }[]>("SELECT UUID() AS id");
    await tx.query(
      "INSERT INTO cashbox (id, description, income, expense, balance, created_by) VALUES (?, ?, ?, ?, ?, ?)",
      [id, data.description, data.income, data.expense, balance, req.user!.id],
    );
    await tx.query("UPDATE cashbox_state SET balance = ? WHERE id = 1", [balance]);
    const row = { id, ...data, balance, balance_before: Number(state.balance) };
    await audit(tx, req.user!.id, "INSERT", "cashbox", id, row);
    return row;
  });
  res.status(201).json(movement);
});
