import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  description: SITE_DESCRIPTION,
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  openGraph: {
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    title: SITE_NAME,
    type: "website"
  },
  title: {
    default: SITE_NAME,
    template: `%s · ${SITE_NAME}`
  },
  twitter: {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    title: SITE_NAME
  }
};

export const viewport: Viewport = {
  colorScheme: "dark light",
  themeColor: [
    { color: "#080d10", media: "(prefers-color-scheme: dark)" },
    { color: "#f3f5f7", media: "(prefers-color-scheme: light)" }
  ]
};

export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider {...(nonce === undefined ? {} : { nonce })}>
          <WebVitalsReporter />
          <SiteHeader />
          <main className="page-shell">{children}</main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
