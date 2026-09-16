import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { loadMonorepoEnv } from "./env-bootstrap";
import {
  allowedOrigins,
  createRateLimit,
  requestTiming,
  securityHeaders,
} from "./http-security";

loadMonorepoEnv();

const logger = new Logger("HttpSecurity");
const rateLimit = createRateLimit();

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || Boolean(process.env.RENDER) || Boolean(process.env.VERCEL);
}

function assertProductionSecurityConfiguration(origins: string[]) {
  if (!isProductionRuntime()) {
    return;
  }
  if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
    throw new Error("AUTH_SECRET must be configured with at least 32 random characters in production");
  }
  if (origins.length === 0) {
    throw new Error("CORS_ORIGINS must contain the approved browser origin(s) in production");
  }
}

async function bootstrap() {
  const { AppModule } = await import("./app.module.js");
  const origins = allowedOrigins();
  assertProductionSecurityConfiguration(origins);
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
      exposedHeaders: [
        "x-request-id",
        "x-response-time-ms",
        "server-timing",
        "ratelimit-limit",
        "ratelimit-remaining",
      ],
    },
  });
  app.setGlobalPrefix("api");
  app.use(securityHeaders);
  app.use(requestTiming);
  app.use(rateLimit);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Render and similar hosts inject PORT. Keep API_PORT as the explicit local
  // override used by the web proxy and development tooling.
  const port = Number(process.env.PORT ?? process.env.API_PORT ?? 4000);
  // The web rewrite targets this exact configured port. Falling forward to a
  // different port leaves Next proxying to an older API process, which is much
  // harder to diagnose than a clear EADDRINUSE startup failure.
  await app.listen(port, "0.0.0.0");
  logger.log({ event: "api_started", port, allowedOrigins: origins.length });
  console.log(`Nest API listening on http://localhost:${port}/api`);
}

void bootstrap();
