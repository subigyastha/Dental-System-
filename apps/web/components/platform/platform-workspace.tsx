"use client";

import { BarChart3, Flag, LifeBuoy, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { KoiPageLoader } from "@/components/koi-loader";
import { Button, Panel } from "@/components/ui";
import { EmptyState, Field, Modal, inputClassName, textareaClassName } from "@/components/workspace/elements";
import { ApiRequestError, apiFetchJson } from "@/lib/api-client";
import type { SessionUser } from "@/lib/domain";
import { logoutCurrentSession } from "@/lib/session-lifecycle";
import { publishSessionEnd, subscribeToSessionEnd } from "@/lib/session-events";
import { signedInRoute } from "@/lib/session-routing";

type PlatformMetrics = {
  organizations: { total: number };
  activeStaff: number;
  featureAdoption: Array<{ featureKey: string; organizationCount: number }>;
};

type FeatureFlag = {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
};

type SupportAccessGrant = {
  id: string;
  organizationId: string;
  requestedByUserId: string;
  reason: string;
  dataDomains: string[];
  readOnly: boolean;
  startsAt: string;
  expiresAt: string;
  status: "Active" | "Revoked" | "Expired";
  effectiveStatus: "Active" | "Revoked" | "Expired";
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
};

type FeatureMutation = {
  enabled: boolean;
  reason: string;
  description?: string;
};

const supportDomains = [
  "organization_configuration",
  "operational_metadata",
  "scheduling_metadata",
] as const;

export function isPlatformSuperAdmin(user?: Pick<SessionUser, "role"> | null) {
  return user?.role === "SuperAdmin";
}

export function isConfigurationOnlyDomain(domain: string) {
  return supportDomains.includes(domain as (typeof supportDomains)[number]);
}

function dateTime(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function toApiError(error: unknown, fallback: string) {
  if (error instanceof ApiRequestError && error.status === 403) return "Platform permission denied.";
  return error instanceof Error ? error.message : fallback;
}

export function PlatformWorkspace() {
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [features, setFeatures] = useState<FeatureFlag[]>([]);
  const [grants, setGrants] = useState<SupportAccessGrant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const signOutRequest = useRef<Promise<void> | null>(null);
  const [featureMutation, setFeatureMutation] = useState<
    { feature: FeatureFlag; organizationId?: string } | null
  >(null);
  const [newGrantOpen, setNewGrantOpen] = useState(false);
  const [revokeGrant, setRevokeGrant] = useState<SupportAccessGrant | null>(null);

  const refreshPlatformData = useCallback(async () => {
    const [nextMetrics, nextFeatures, nextGrants] = await Promise.all([
      apiFetchJson<PlatformMetrics>("/platform/metrics", { cache: "no-store" }),
      apiFetchJson<FeatureFlag[]>("/platform/features", { cache: "no-store" }),
      apiFetchJson<SupportAccessGrant[]>("/platform/support-access", { cache: "no-store" }),
    ]);
    setMetrics(nextMetrics);
    setFeatures(nextFeatures);
    setGrants(nextGrants);
  }, []);

  const loadPlatform = useCallback(async () => {
    setError(null);
    try {
      const currentUser = await apiFetchJson<SessionUser>("/auth/me", { cache: "no-store" });
      if (!isPlatformSuperAdmin(currentUser)) {
        router.replace(signedInRoute(currentUser));
        return;
      }
      setUser(currentUser);
      await refreshPlatformData();
    } catch (loadError) {
      if (loadError instanceof ApiRequestError && loadError.status === 401) {
        router.replace("/login");
        return;
      }
      setError(toApiError(loadError, "Could not load platform controls."));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [refreshPlatformData, router]);

  useEffect(() => {
    void loadPlatform();
  }, [loadPlatform]);

  useEffect(() => subscribeToSessionEnd(() => {
    setUser(null);
    setMetrics(null);
    setFeatures([]);
    setGrants([]);
    router.replace("/login");
  }), [router]);

  const signOut = useCallback(() => {
    if (signOutRequest.current) return signOutRequest.current;
    setSignOutError(null);
    setIsLoggingOut(true);
    const request = (async () => {
      try {
        const reason = await logoutCurrentSession();
        setUser(null);
        setMetrics(null);
        setFeatures([]);
        setGrants([]);
        if (reason === "signed-out") publishSessionEnd(reason);
        router.replace("/login");
      } catch {
        setSignOutError(
          "We could not sign you out because the server could not confirm session revocation. Check your connection and try again.",
        );
      } finally {
        signOutRequest.current = null;
        setIsLoggingOut(false);
      }
    })();
    signOutRequest.current = request;
    return request;
  }, [router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)]">
        <KoiPageLoader label="Loading platform controls" />
      </div>
    );
  }

  if (error) {
    return (
      <PlatformMessage
        body={error}
        onRetry={() => {
          setIsLoading(true);
          void loadPlatform();
        }}
        title="Platform controls unavailable"
      />
    );
  }

  if (!isPlatformSuperAdmin(user)) {
    return <PlatformMessage body="Redirecting to the appropriate workspace." title="Platform access is restricted" />;
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <div className="grid min-h-screen lg:grid-cols-[56px_272px_minmax(0,1fr)]">
        <aside className="hidden border-r border-[var(--border)] bg-[var(--surface)] py-3 lg:flex lg:flex-col lg:items-center">
          <div className="flex size-9 items-center justify-center rounded-md bg-[var(--color-selected)] text-[var(--color-primary-hover)]" title="Platform controls">
            <ShieldCheck aria-hidden="true" size={19} />
          </div>
          <nav aria-label="Platform destinations" className="mt-6 flex flex-1 flex-col items-center gap-2">
            <RailIcon active icon={BarChart3} label="Platform overview" />
            <RailIcon icon={Flag} label="Feature controls" />
            <RailIcon icon={LifeBuoy} label="Support access" />
          </nav>
          <button
            aria-label={isLoggingOut ? "Signing out" : "Sign out"}
            className="flex size-9 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--foreground)] disabled:cursor-wait disabled:opacity-60"
            disabled={isLoggingOut}
            onClick={() => void signOut()}
            title={isLoggingOut ? "Signing out" : "Sign out"}
            type="button"
          >
            <LogOut aria-hidden="true" size={18} />
          </button>
        </aside>

        <aside className="hidden border-r border-[var(--border)] bg-[var(--sidebar)] px-3 py-5 lg:flex lg:flex-col">
          <div className="border-b border-[var(--border)] px-2 pb-4">
            <div className="text-sm font-semibold text-[var(--foreground)]">Platform operations</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">Aggregate controls only</div>
          </div>
          <nav aria-label="Platform sections" className="mt-4 flex-1 space-y-1">
            <SidebarItem icon={BarChart3} label="Overview" />
            <SidebarItem icon={Flag} label="Feature flags" />
            <SidebarItem icon={LifeBuoy} label="Support access" />
          </nav>
          <div className="border-t border-[var(--border)] px-2 pt-4">
            <div className="text-sm font-medium text-[var(--foreground)]">{user?.name}</div>
            <div className="mt-1 text-xs text-[var(--text-muted)]">Super Admin</div>
          </div>
        </aside>

        <main className="min-w-0 px-4 py-5 lg:px-6 lg:py-6">
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold leading-7">Platform overview</h1>
              <p className="mt-1 text-sm text-[var(--text-muted)]">De-identified operational adoption and configuration controls.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={isRefreshing || isLoggingOut}
                onClick={() => {
                  setIsRefreshing(true);
                  void refreshPlatformData()
                    .catch((refreshError) => setError(toApiError(refreshError, "Could not refresh platform controls.")))
                    .finally(() => setIsRefreshing(false));
                }}
                variant="secondary"
              >
                <RefreshCw aria-hidden="true" size={16} />
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </Button>
              <Button
                disabled={isLoggingOut}
                loading={isLoggingOut}
                loadingLabel="Signing out…"
                onClick={() => void signOut()}
                variant="ghost"
              >
                <LogOut aria-hidden="true" size={16} />
                Sign out
              </Button>
            </div>
          </header>

          {signOutError ? (
            <p aria-live="assertive" className="mb-5 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-[var(--danger)]" role="alert">
              {signOutError}
            </p>
          ) : null}

          <section aria-label="Aggregate platform metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard label="Clinics onboarded" value={String(metrics?.organizations.total ?? 0)} />
            <MetricCard label="Active clinic staff" value={String(metrics?.activeStaff ?? 0)} />
            <MetricCard label="Adopted features" value={String(metrics?.featureAdoption.length ?? 0)} />
          </section>

          <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
            <Panel title="Feature flags">
              <div className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
                Global flags can be changed with an audit reason. Per-organization overrides require an explicit organization ID; this workspace does not browse clinic data.
              </div>
              {features.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {features.map((feature) => (
                    <div className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" key={feature.key}>
                      <div>
                        <div className="font-medium text-[var(--foreground)]">{feature.key}</div>
                        <div className="mt-1 text-sm text-[var(--text-muted)]">{feature.description ?? "No description recorded."}</div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">Updated {dateTime(feature.updatedAt)}</div>
                      </div>
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <span className={`self-center rounded-md px-2 py-1 text-xs font-medium ${feature.enabled ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>
                          {feature.enabled ? "Enabled" : "Disabled"}
                        </span>
                        <Button onClick={() => setFeatureMutation({ feature })} variant="secondary">Change</Button>
                        <Button onClick={() => setFeatureMutation({ feature, organizationId: "" })} variant="ghost">Override</Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4"><EmptyState body="No platform feature flags have been configured." title="No feature flags" /></div>
              )}
            </Panel>

            <Panel action={<Button onClick={() => setNewGrantOpen(true)}><LifeBuoy size={16} />Create grant</Button>} title="Support access">
              <div className="border-b border-[var(--border)] px-4 py-3 text-sm text-[var(--text-muted)]">
                Grants are temporary, read-only, and limited to configuration or metadata domains. Client, record, and finance access are not available here.
              </div>
              {grants.length ? (
                <div className="divide-y divide-[var(--border)]">
                  {grants.map((grant) => (
                    <div className="px-4 py-4" key={grant.id}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="font-mono text-xs text-[var(--foreground)]">Org: {grant.organizationId}</div>
                        <span className={`rounded-md px-2 py-1 text-xs font-medium ${grant.effectiveStatus === "Active" ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]" : "bg-[var(--surface-muted)] text-[var(--text-muted)]"}`}>{grant.effectiveStatus}</span>
                      </div>
                      <p className="mt-2 text-sm text-[var(--foreground)]">{grant.reason}</p>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">Read-only · {grant.dataDomains.join(", ")} · {dateTime(grant.startsAt)} to {dateTime(grant.expiresAt)}</p>
                      {grant.effectiveStatus === "Active" ? <Button className="mt-3" onClick={() => setRevokeGrant(grant)} variant="ghost">Revoke</Button> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4"><EmptyState body="No temporary support access grants are active or recorded." title="No support grants" /></div>
              )}
            </Panel>
          </section>

          <Panel className="mt-6" title="Feature adoption">
            {metrics?.featureAdoption.length ? (
              <div className="divide-y divide-[var(--border)]">
                {metrics.featureAdoption.map((item) => (
                  <div className="flex items-center justify-between px-4 py-3 text-sm" key={item.featureKey}>
                    <span className="font-medium text-[var(--foreground)]">{item.featureKey}</span>
                    <span className="font-variant-numeric:tabular-nums text-[var(--text-muted)]">{item.organizationCount} clinic(s)</span>
                  </div>
                ))}
              </div>
            ) : <div className="p-4"><EmptyState body="Adoption events will appear as aggregate feature counts only." title="No adoption events" /></div>}
          </Panel>
        </main>
      </div>

      {featureMutation ? <FeatureMutationModal feature={featureMutation.feature} initialOrganizationId={featureMutation.organizationId} onClose={() => setFeatureMutation(null)} onSaved={async () => { setFeatureMutation(null); await refreshPlatformData(); }} /> : null}
      {newGrantOpen ? <SupportGrantModal onClose={() => setNewGrantOpen(false)} onSaved={async () => { setNewGrantOpen(false); await refreshPlatformData(); }} /> : null}
      {revokeGrant ? <RevokeGrantModal grant={revokeGrant} onClose={() => setRevokeGrant(null)} onSaved={async () => { setRevokeGrant(null); await refreshPlatformData(); }} /> : null}
    </div>
  );
}

function RailIcon({ active, icon: Icon, label }: { active?: boolean; icon: typeof BarChart3; label: string }) {
  return <div aria-label={label} className={`flex size-9 items-center justify-center rounded-md ${active ? "bg-[var(--color-selected)] text-[var(--color-primary-hover)]" : "text-[var(--text-muted)]"}`} title={label}><Icon aria-hidden="true" size={18} /></div>;
}

function SidebarItem({ icon: Icon, label }: { icon: typeof BarChart3; label: string }) {
  return <div className="flex min-h-9 items-center gap-3 rounded-md px-2.5 py-2 text-sm text-[var(--foreground)]"><Icon aria-hidden="true" size={16} /><span>{label}</span></div>;
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return <Panel><div className="p-4"><div className="text-sm text-[var(--text-muted)]">{label}</div><div className="mt-2 font-variant-numeric:tabular-nums text-2xl font-semibold text-[var(--foreground)]">{value}</div></div></Panel>;
}

function PlatformMessage({ body, onRetry, title }: { body: string; onRetry?: () => void; title: string }) {
  return <main className="flex min-h-screen items-center justify-center bg-[var(--background)] p-4"><div className="w-full max-w-md"><EmptyState actionLabel={onRetry ? "Retry" : undefined} body={body} onAction={onRetry} title={title} /></div></main>;
}

function FeatureMutationModal({ feature, initialOrganizationId, onClose, onSaved }: { feature: FeatureFlag; initialOrganizationId?: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const [enabled, setEnabled] = useState(feature.enabled);
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState(feature.description ?? "");
  const [organizationId, setOrganizationId] = useState(initialOrganizationId ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isOverride = initialOrganizationId !== undefined;
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setError(null); setIsSaving(true); try { const payload: FeatureMutation = { enabled, reason, description: description || undefined }; const path = isOverride ? `/platform/features/${encodeURIComponent(feature.key)}/organizations/${encodeURIComponent(organizationId)}` : `/platform/features/${encodeURIComponent(feature.key)}`; await apiFetchJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); await onSaved(); } catch (requestError) { setError(toApiError(requestError, "Could not save the feature change.")); } finally { setIsSaving(false); } }
  return <Modal onClose={onClose} title={isOverride ? `Override ${feature.key}` : `Change ${feature.key}`} subtitle="A reason is required and the platform audit trail records the server-confirmed change."><form className="space-y-4" onSubmit={submit}>{isOverride ? <Field label="Organization ID"><input className={inputClassName} onChange={(event) => setOrganizationId(event.target.value)} required value={organizationId} /></Field> : <Field label="Description"><input className={inputClassName} onChange={(event) => setDescription(event.target.value)} value={description} /></Field>}<label className="flex items-center justify-between rounded-md border border-[var(--border)] p-3 text-sm"><span>Feature enabled</span><input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" /></label><Field label="Reason"><textarea className={textareaClassName} onChange={(event) => setReason(event.target.value)} required value={reason} /></Field>{error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}<div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={!reason.trim() || (isOverride && !organizationId.trim())} loading={isSaving} loadingLabel="Saving..." type="submit">Save change</Button></div></form></Modal>;
}

function SupportGrantModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [organizationId, setOrganizationId] = useState(""); const [reason, setReason] = useState(""); const [domains, setDomains] = useState<string[]>(["organization_configuration"]); const [startsAt, setStartsAt] = useState(""); const [expiresAt, setExpiresAt] = useState(""); const [error, setError] = useState<string | null>(null); const [isSaving, setIsSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setError(null); setIsSaving(true); try { const start = new Date(startsAt); const end = new Date(expiresAt); if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new Error("A valid start and expiry time are required."); await apiFetchJson("/platform/support-access", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ organizationId, reason, dataDomains: domains, startsAtIso: start.toISOString(), expiresAtIso: end.toISOString(), readOnly: true }) }); await onSaved(); } catch (requestError) { setError(toApiError(requestError, "Could not create the support grant.")); } finally { setIsSaving(false); } }
  return <Modal onClose={onClose} title="Create support access grant" subtitle="Support is configuration-only and read-only; identifiable client, record, and financial data are excluded."><form className="space-y-4" onSubmit={submit}><Field label="Organization ID"><input className={inputClassName} onChange={(event) => setOrganizationId(event.target.value)} required value={organizationId} /></Field><Field label="Support reason"><textarea className={textareaClassName} onChange={(event) => setReason(event.target.value)} required value={reason} /></Field><div><div className="text-sm font-medium text-[var(--foreground)]">Allowed data domains</div><div className="mt-2 space-y-2">{supportDomains.map((domain) => <label className="flex items-center gap-2 text-sm" key={domain}><input checked={domains.includes(domain)} onChange={(event) => setDomains((current) => event.target.checked ? [...current, domain] : current.filter((item) => item !== domain))} type="checkbox" />{domain.replaceAll("_", " ")}</label>)}</div></div><label className="flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm"><input checked disabled type="checkbox" />Read-only access (required)</label><div className="grid gap-4 sm:grid-cols-2"><Field label="Starts at"><input className={inputClassName} onChange={(event) => setStartsAt(event.target.value)} required type="datetime-local" value={startsAt} /></Field><Field label="Expires at"><input className={inputClassName} min={startsAt} onChange={(event) => setExpiresAt(event.target.value)} required type="datetime-local" value={expiresAt} /></Field></div>{error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}<div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={!organizationId.trim() || !reason.trim() || !domains.length || !startsAt || !expiresAt} loading={isSaving} loadingLabel="Creating..." type="submit">Create grant</Button></div></form></Modal>;
}

function RevokeGrantModal({ grant, onClose, onSaved }: { grant: SupportAccessGrant; onClose: () => void; onSaved: () => Promise<void> }) {
  const [reason, setReason] = useState(""); const [error, setError] = useState<string | null>(null); const [isSaving, setIsSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setError(null); setIsSaving(true); try { await apiFetchJson(`/platform/support-access/${grant.id}/revoke`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }); await onSaved(); } catch (requestError) { setError(toApiError(requestError, "Could not revoke the support grant.")); } finally { setIsSaving(false); } }
  return <Modal onClose={onClose} title="Revoke support access" subtitle="The reason and server-confirmed revocation are recorded in the platform audit trail."><form className="space-y-4" onSubmit={submit}><p className="rounded-md border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm">Organization: <span className="font-mono">{grant.organizationId}</span></p><Field label="Reason"><textarea className={textareaClassName} onChange={(event) => setReason(event.target.value)} required value={reason} /></Field>{error ? <p className="text-sm text-[var(--color-danger)]">{error}</p> : null}<div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={!reason.trim()} loading={isSaving} loadingLabel="Revoking..." type="submit">Revoke grant</Button></div></form></Modal>;
}
