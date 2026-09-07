"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Authentication expiry is application-wide. API requests emit one event on
 * HTTP 401; this boundary ensures every screen returns to sign-in.
 */
export function SessionExpiryRedirect() {
  const router = useRouter();

  useEffect(() => {
    const redirectToLogin = () => {
      router.replace("/login");
    };

    window.addEventListener("clinicflow:session-expired", redirectToLogin);
    return () => window.removeEventListener("clinicflow:session-expired", redirectToLogin);
  }, [router]);

  return null;
}
