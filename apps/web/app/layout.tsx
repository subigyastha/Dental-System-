import type { Metadata, Viewport } from "next";

import { SessionExpiryRedirect } from "@/components/session-expiry-redirect";
import { PwaProvider } from "@/components/pwa-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClinicFlow | Koi Workflow System",
  description: "Dental scheduling and operational coordination platform",
  applicationName: "ClinicFlow",
  appleWebApp: { capable: true, title: "ClinicFlow", statusBarStyle: "default" },
  icons: {
    icon: "/just-icon.svg",
    shortcut: "/just-icon.svg",
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0b6e99",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PwaProvider>
          <SessionExpiryRedirect />
          {children}
        </PwaProvider>
      </body>
    </html>
  );
}
