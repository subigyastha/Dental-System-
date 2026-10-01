"use client";

import { Download } from "lucide-react";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const PwaContext = createContext<{
  installed: boolean;
  installPrompt: InstallPrompt | null;
  clearPrompt: () => void;
}>({ installed: false, installPrompt: null, clearPrompt: () => undefined });

export function PwaProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const displayMode = window.matchMedia("(display-mode: standalone)");
    const syncInstalled = () => setInstalled(
      displayMode.matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    );
    const syncNetwork = () => setOffline(!navigator.onLine);
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const onInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    syncInstalled();
    syncNetwork();
    displayMode.addEventListener("change", syncInstalled);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", syncNetwork);
    window.addEventListener("offline", syncNetwork);

    // Only the public offline screen is cached; clinic pages and APIs stay online.
    if ("serviceWorker" in navigator && window.isSecureContext) {
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => console.warn("ClinicFlow offline screen could not be registered."));
    }
    return () => {
      displayMode.removeEventListener("change", syncInstalled);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", syncNetwork);
      window.removeEventListener("offline", syncNetwork);
    };
  }, []);

  return (
    <PwaContext.Provider value={{ installed, installPrompt, clearPrompt: () => setInstallPrompt(null) }}>
      {offline ? (
        <div className="network-status" role="status">
          You’re offline. Reconnect before booking or saving changes.
        </div>
      ) : null}
      {children}
    </PwaContext.Provider>
  );
}

/** One install action shared by desktop Profile and mobile More. */
export function InstallAppButton() {
  const { installed, installPrompt, clearPrompt } = useContext(PwaContext);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState(false);
  if (installed) return null;

  async function install() {
    if (busy) return;
    if (!installPrompt) {
      setHelp((shown) => !shown);
      return;
    }
    setBusy(true);
    try {
      // Browsers require this call to originate from the user's tap.
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === "dismissed") setHelp(true);
    } catch {
      setHelp(true);
    } finally {
      clearPrompt();
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className="app-button flex min-h-[44px] w-full items-center justify-center gap-2 rounded-md border border-[var(--border)] px-3 py-3 text-sm font-medium text-[var(--accent)] disabled:opacity-60"
        disabled={busy}
        onClick={() => void install()}
        type="button"
      >
        <Download aria-hidden="true" size={17} />
        {busy ? "Opening installation…" : "Install app"}
      </button>
      {help ? (
        <p className="mt-2 text-sm text-[var(--text-muted)]" role="status">
          On iPhone or iPad, open ClinicFlow in Safari, tap Share, then Add to Home Screen.
          On Android or desktop, use your browser menu’s Install app or Add to Home Screen option.
        </p>
      ) : null}
    </div>
  );
}
