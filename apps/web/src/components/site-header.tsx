import { Activity, BarChart3, GitCompareArrows, Landmark, Route, Search } from "lucide-react";
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
  const user = await getAuthenticatedUser();
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link aria-label="RWA Yield Router home" className="brand" href="/">
          <span className="brand-mark" aria-hidden>
            <Landmark size={18} />
          </span>
          <span>RWA Yield Router</span>
          <span className="brand-tag">Research</span>
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
      </div>
    </header>
  );
}
