import { loadEnvConfig } from "@next/env";
import { join } from "node:path";
import type { NextConfig } from "next";

// Load `.env` / `.env.local` from the monorepo root (not only `apps/web`).
const monorepoRoot = join(__dirname, "../..");
loadEnvConfig(monorepoRoot);

const nextConfig: NextConfig = {};

export default nextConfig;
