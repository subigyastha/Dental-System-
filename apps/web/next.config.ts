import { loadEnvConfig } from "@next/env";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load `.env` / `.env.local` from the monorepo root (not only `apps/web`).
const monorepoRoot = join(__dirname, "../..");
loadEnvConfig(monorepoRoot);

const configuredNestApiBase =
  process.env.NEST_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  `http://localhost:${process.env.API_PORT ?? "4000"}/api`;

if (!/^https?:\/\//.test(configuredNestApiBase)) {
  throw new Error("NEST_API_URL or NEXT_PUBLIC_API_URL must be an absolute Nest API URL");
}

const nestApiUrl = new URL(configuredNestApiBase);
// Render service URLs are commonly configured as an origin only. Nest serves
// every controller under the global /api prefix, so normalize an origin-only
// value while leaving explicit paths (including /api) untouched.
if (nestApiUrl.pathname === "/") {
  nestApiUrl.pathname = "/api";
}
const nestApiBase = nestApiUrl.toString().replace(/\/$/, "");

const nextConfig: NextConfig = {
  // A running dev server and `next build` must never write the same artifact
  // tree. Otherwise a build can replace chunks while dev is still serving
  // them, producing persistent 500s until the cache is manually removed.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  async rewrites() {
    return {
      // This runs before the disabled legacy Next route handlers, preserving
      // one browser origin while forwarding all API traffic to Nest.
      beforeFiles: [
        {
          source: "/api/:path*",
          destination: `${nestApiBase.replace(/\/$/, "")}/:path*`,
        },
      ],
    };
  },
};

export default nextConfig;
