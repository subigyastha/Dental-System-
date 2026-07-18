"use client";

import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui";
import { apiFetchJson, rememberCsrfToken } from "@/lib/api-client";
import type { SessionUser } from "@/lib/domain";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("owner@zendenta.local");
  const [password, setPassword] = useState("demo-password");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const result = await apiFetchJson<{ user: SessionUser; csrfToken: string }>("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      rememberCsrfToken(result.csrfToken);
      router.replace(result.user.providerId && ["Provider", "Assistant"].includes(result.user.role) ? "/my-schedule" : "/dashboard");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Could not sign in");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--card-shadow)] lg:grid-cols-[minmax(0,1.1fr)_420px]">
        <section className="hidden border-r border-[var(--border)] bg-[var(--surface-muted)] p-10 lg:block">
          <div className="max-w-md">
            <Image
              alt="Nepal Koi Tech"
              className="h-10 w-auto"
              height={40}
              src="/with-text.svg"
              width={160}
            />
            <h1 className="mt-4 text-4xl font-semibold text-[var(--foreground)]">
              Dental operations, without the visual noise.
            </h1>
            <p className="mt-4 text-sm leading-6 text-[var(--text-muted)]">
              Reservations, patients, staff, billing, and clinic settings live in one calm workspace.
            </p>
          </div>
        </section>

        <section className="p-6 sm:p-8">
          <div className="max-w-sm">
            <div className="flex items-center gap-3">
              <Image alt="Nepal Koi Tech" className="h-8 w-8" height={32} src="/just-icon.svg" width={32} />
              <div className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
                Sign in
              </div>
            </div>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              Open the clinic workspace
            </h2>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Use the owner or staff account already seeded in the system.
            </p>

            <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--foreground)]">Email</span>
                <input
                  className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none"
                  onChange={(event) => setEmail(event.target.value)}
                  type="email"
                  value={email}
                />
              </label>

              <label className="block space-y-2">
                <span className="text-sm font-medium text-[var(--foreground)]">Password</span>
                <input
                  className="h-11 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none"
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  value={password}
                />
              </label>

              {error ? (
                <div className="rounded-md border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
                  {error}
                </div>
              ) : null}

              <Button className="w-full" type="submit">
                {isSubmitting ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-muted)]">
              Demo owner: <span className="font-medium text-[var(--foreground)]">owner@zendenta.local</span>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
