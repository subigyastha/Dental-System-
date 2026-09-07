import type { Metadata } from "next";

import { SessionExpiryRedirect } from "@/components/session-expiry-redirect";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClinicFlow | Koi Workflow System",
  description: "Dental scheduling and operational coordination platform",
  icons: {
    icon: "/just-icon.svg",
    shortcut: "/just-icon.svg",
    apple: "/just-icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <SessionExpiryRedirect />
        {children}
      </body>
    </html>
  );
}
