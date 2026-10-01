"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { subscribeToSessionEnd } from "@/lib/session-events";

/**
 * Session end is application-wide. Use the same local and cross-tab
 * subscription as workspace state so every screen returns to sign-in.
 */
export function SessionExpiryRedirect() {
  const router = useRouter();

  useEffect(() => {
    const redirectToLogin = () => {
      router.replace("/login");
    };

    return subscribeToSessionEnd(redirectToLogin);
  }, [router]);

  return null;
}
