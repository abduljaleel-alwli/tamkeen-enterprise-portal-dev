"use client";

import { useEffect, useRef } from "react";

const CHANNEL = "tamkeen-portal-updates";

export function signalPortalUpdate(scope = "all") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHANNEL, { detail: scope }));
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ scope, at: Date.now() });
    channel.close();
  } catch {
    localStorage.setItem(CHANNEL, JSON.stringify({ scope, at: Date.now() }));
  }
}

export function usePortalLiveSync(refresh: () => void | Promise<void>, scopes: string[] = ["all"], intervalMs = 5000) {
  const latest = useRef(refresh);
  const scopeKey = scopes.join("|");
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    const acceptedScopes = scopeKey.split("|");
    const accepts = (scope?: string) => !scope || scope === "all" || acceptedScopes.includes(scope);
    const run = (scope?: string) => { if (accepts(scope)) void latest.current(); };
    const custom = (event: Event) => run((event as CustomEvent<string>).detail);
    const storage = (event: StorageEvent) => {
      if (event.key !== CHANNEL || !event.newValue) return;
      try { run(JSON.parse(event.newValue).scope); } catch { run(); }
    };
    let broadcast: BroadcastChannel | null = null;
    try {
      broadcast = new BroadcastChannel(CHANNEL);
      broadcast.onmessage = (event) => run(event.data?.scope);
    } catch { /* localStorage is the fallback */ }
    const visibility = () => { if (document.visibilityState === "visible") run(); };
    window.addEventListener(CHANNEL, custom);
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => run(), intervalMs);
    return () => {
      window.removeEventListener(CHANNEL, custom);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visibility);
      window.clearInterval(timer);
      broadcast?.close();
    };
  }, [intervalMs, scopeKey]);
}
