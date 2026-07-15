import { AccountGate } from "@/components/account-gate";
import { PageHeader } from "@/components/page-header";
import { SavedSimulationsManager } from "@/components/saved-simulations-manager";

export const metadata = { robots: { index: false }, title: "Saved simulations" };

export default function SimulationsPage() {
  return (
    <>
      <PageHeader
        description="Saved simulations preserve immutable inputs, exclusions, data cutoff, methodology, solver version, allocation, and diagnostics."
        eyebrow="Private workspace"
        title="Saved simulations"
      />
      <AccountGate>
        <SavedSimulationsManager />
      </AccountGate>
    </>
  );
}
