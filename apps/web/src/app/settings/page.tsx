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
        </div>
      </AccountGate>
    </>
  );
}
