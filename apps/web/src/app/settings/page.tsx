import Link from "next/link";
import { AccountGate } from "@/components/account-gate";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings-form";
import { MfaManager } from "@/components/mfa-manager";

export const metadata = { robots: { index: false }, title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        description="Set jurisdiction, risk, chain, and timezone defaults. Eligibility is always reevaluated from current sourced rules."
        eyebrow="Private workspace"
        title="Account settings"
      />
      <AccountGate>
        <div className="stack">
          <SettingsForm />
          <MfaManager />
          <section className="panel">
            <span className="eyebrow">Saved research</span>
            <h2>Return to your private comparison and screener presets</h2>
            <p>
              Saved names and presets remain account-private. Route-based comparison and filter URLs
              remain public and shareable.
            </p>
            <div className="inline-actions">
              <Link className="button button-secondary" href="/compare">
                Manage comparisons
              </Link>
              <Link className="button button-secondary" href="/screener">
                Manage screener views
              </Link>
            </div>
          </section>
        </div>
      </AccountGate>
    </>
  );
}
