import { randomUUID } from "node:crypto";

export type HttpRequest = {
  path: string;
  ip?: string;
  header(name: string): string | undefined;
  requestId?: string;
};

export type HttpResponse = {
  setHeader(name: string, value: string): void;
  status(code: number): { json(body: unknown): void };
};

export type Next = () => void;

export function allowedOrigins(environment = process.env) {
  const configured = environment.CORS_ORIGINS
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured?.length) {
    return configured;
  }

  return environment.NODE_ENV === "production"
    ? []
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
}

export function createRateLimit(options?: {
  loginLimit?: number;
  generalLimit?: number;
  loginWindowMs?: number;
  generalWindowMs?: number;
}) {
  const counts = new Map<string, { count: number; resetAt: number }>();
  const loginLimit = options?.loginLimit ?? 10;
  const generalLimit = options?.generalLimit ?? 600;
  const loginWindowMs = options?.loginWindowMs ?? 15 * 60_000;
  const generalWindowMs = options?.generalWindowMs ?? 60_000;

  return (req: HttpRequest, res: HttpResponse, next: Next) => {
    const isLogin = req.path === "/api/auth/login";
    const limit = isLogin ? loginLimit : generalLimit;
    const windowMs = isLogin ? loginWindowMs : generalWindowMs;
    const now = Date.now();
    const key = `${isLogin ? "login" : "api"}:${req.ip ?? "unknown"}`;
    const record = counts.get(key);
    const active = !record || record.resetAt <= now ? { count: 0, resetAt: now + windowMs } : record;
    active.count += 1;
    counts.set(key, active);
    res.setHeader("RateLimit-Limit", String(limit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, limit - active.count)));

    if (active.count > limit) {
      res.setHeader("Retry-After", String(Math.ceil((active.resetAt - now) / 1000)));
      res.status(429).json({ statusCode: 429, message: "Too many requests" });
      return;
    }

    next();
  };
}

export function securityHeaders(req: HttpRequest, res: HttpResponse, next: Next) {
  const requestId = req.header("x-request-id")?.trim() || randomUUID();
  res.setHeader("x-request-id", requestId);
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("permissions-policy", "camera=(), microphone=(), geolocation=()");
  req.requestId = requestId;
  next();
}
