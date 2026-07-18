import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { loadMonorepoEnv } from "./env-bootstrap";
import { allowedOrigins, createRateLimit, securityHeaders } from "./http-security";

loadMonorepoEnv();

const logger = new Logger("HttpSecurity");
const rateLimit = createRateLimit();

function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code === "EADDRINUSE"
  );
}

async function listenOnAvailablePort(
  app: INestApplication,
  preferredPort: number,
  maxAttempts = 15,
): Promise<number> {
  let lastErr: unknown;
  for (let offset = 0; offset < maxAttempts; offset++) {
    const port = preferredPort + offset;
    try {
      await app.listen(port);
      if (offset > 0) {
        console.warn(
          `[api] Port ${preferredPort} is in use; listening on ${port} instead. Set API_PORT=${port} in .env or stop the other process.`,
        );
      }
      return port;
    } catch (err) {
      lastErr = err;
      if (isAddrInUse(err)) {
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const origins = allowedOrigins();
  const app = await NestFactory.create(AppModule, {
    cors: {
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error("Origin is not allowed"));
      },
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "authorization",
        "content-type",
        "idempotency-key",
        "x-request-id",
        "x-csrf-token",
      ],
      exposedHeaders: ["x-request-id", "ratelimit-limit", "ratelimit-remaining"],
    },
  });
  app.setGlobalPrefix("api");
  app.use(securityHeaders);
  app.use(rateLimit);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const preferred = Number(process.env.API_PORT ?? 4000);
  const port = await listenOnAvailablePort(app, preferred);
  logger.log({ event: "api_started", port, allowedOrigins: origins.length });
  console.log(`Nest API listening on http://localhost:${port}/api`);
}

void bootstrap();
