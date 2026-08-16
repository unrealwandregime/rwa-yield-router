import { getServerConfig } from "@rwa-yield-router/config";
import { Activity, BarChart3, GitCompareArrows, Landmark, Menu, Route, Search } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { getAuthenticatedUser } from "@/lib/supabase/server";

const primaryNav = [
  { href: "/dashboard", icon: BarChart3, label: "Overview" },
  { href: "/screener", icon: Search, label: "Screener" },
  { href: "/compare", icon: GitCompareArrows, label: "Compare" },
  { href: "/simulator", icon: Route, label: "Simulator" },
  { href: "/status", icon: Activity, label: "Data health" }
];

export async function SiteHeader() {
  const config = getServerConfig();
  const preview = config.deploymentTier === "preview";
  const user = await getAuthenticatedUser();
  return (
    <>
      <header className="site-header">
        <div className="header-inner">
          <Link aria-label="RWA Yield Router home" className="brand" href="/">
            <span className="brand-mark" aria-hidden>
              <Landmark size={18} />
            </span>
            <span>RWA Yield Router</span>
            <span className="brand-tag">{preview ? "Preview" : "Research"}</span>
          </Link>
          <nav aria-label="Primary navigation" className="primary-nav">
            {primaryNav.map(({ href, icon: Icon, label }) => (
              <Link href={href} key={href}>
                <Icon aria-hidden size={15} />
                {label}
              </Link>
            ))}
          </nav>
          <div className="header-actions">
            <ThemeToggle />
            {user ? (
              <>
                <Link className="button button-secondary button-small" href="/settings">
                  Account
                </Link>
                <SignOutButton />
              </>
            ) : (
              <Link className="button button-secondary button-small" href="/auth/sign-in">
                Sign in
              </Link>
            )}
          </div>
          <details className="mobile-nav">
            <summary aria-label="Open navigation" className="icon-button">
              <Menu aria-hidden size={17} />
            </summary>
            <nav aria-label="Mobile navigation">
              {primaryNav.map(({ href, icon: Icon, label }) => (
                <Link href={href} key={href}>
                  <Icon aria-hidden size={16} />
                  {label}
                </Link>
              ))}
              {user ? (
                <>
                  <Link href="/settings">Account</Link>
                  <SignOutButton />
                </>
              ) : (
                <Link href="/auth/sign-in">Sign in</Link>
              )}
            </nav>
          </details>
        </div>
      </header>
      {preview ? (
        <aside aria-label="Preview limitations" className="preview-notice">
          Zero-cost public preview: services may sleep and outbound notifications are disabled. See{" "}
          <Link href="/status">data health</Link>.
        </aside>
      ) : null}
    </>
  );
}
