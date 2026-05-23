import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { loadMonorepoEnv } from "./env-bootstrap";

loadMonorepoEnv();

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
  const app = await NestFactory.create(AppModule, { cors: true });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const preferred = Number(process.env.API_PORT ?? 4000);
  const port = await listenOnAvailablePort(app, preferred);
  console.log(`Nest API listening on http://localhost:${port}/api`);
}

void bootstrap();
