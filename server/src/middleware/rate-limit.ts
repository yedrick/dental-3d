import { ipKeyGenerator, rateLimit, type ClientRateLimitInfo, type Options, type Store } from "express-rate-limit";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { HttpError } from "../lib/http-error.js";
import { tenancy } from "../tenancy/index.js";

/**
 * Contador de intentos en Redis (si hay REDIS_URL): compartido por todos los procesos de la API
 * (API_PROCESSES) y no se reinicia al reiniciar la API. Sin Redis, en la memoria del proceso.
 */
class RedisStore implements Store {
  localKeys = false;
  private windowMs = 60_000;
  constructor(
    private client: Redis,
    public prefix: string,
  ) {}
  init(options: Options) {
    this.windowMs = options.windowMs;
  }
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const k = this.prefix + key;
    // INCR + PEXPIRE NX (solo la primera vez fija la ventana) en un solo viaje
    const res = await this.client.multi().incr(k).pexpire(k, this.windowMs, "NX").pttl(k).exec();
    const totalHits = Number(res?.[0]?.[1] ?? 1);
    const ttl = Number(res?.[2]?.[1] ?? this.windowMs);
    return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }
  async decrement(key: string) {
    await this.client.decr(this.prefix + key);
  }
  async resetKey(key: string) {
    await this.client.del(this.prefix + key);
  }
}

let redis: Redis | null = null;
function redisClient(): Redis | null {
  if (!config.tenancy.redisUrl) return null;
  // Sin cola offline: si Redis no responde, el límite deja pasar (passOnStoreError) en vez de colgar el login
  if (!redis) {
    redis = new Redis(config.tenancy.redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    redis.on("error", (err) => tenancy.observability.logger.warn({ err }, "rate-limit: Redis no disponible"));
  }
  return redis;
}

// Límites por sucursal + IP (con IPv6 agrupado por /56), para frenar fuerza bruta de contraseñas.
function limiter(name: string, windowMs: number, limit: number, message: string) {
  const client = redisClient();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => `${tenancy.currentId() ?? "central"}:${ipKeyGenerator(req.ip ?? "")}`,
    handler: (_req, _res, next) => next(new HttpError(429, message)),
    ...(client ? { store: new RedisStore(client, `dental3d:rl:${name}:`), passOnStoreError: true } : {}),
  });
}

export const loginLimiter = limiter("login", 15 * 60_000, 10, "Demasiados intentos de inicio de sesión. Espera 15 minutos.");
export const registerLimiter = limiter("register", 60 * 60_000, 5, "Demasiados registros desde esta conexión. Intenta más tarde.");
// Pedir códigos para recuperar la contraseña: pocos por IP (además, máx. 1 por minuto por usuario)
export const forgotLimiter = limiter("forgot", 15 * 60_000, 5, "Demasiados pedidos de código. Espera 15 minutos.");
export const sensitiveLimiter = limiter("sensitive", 15 * 60_000, 10, "Demasiados intentos. Espera 15 minutos.");
