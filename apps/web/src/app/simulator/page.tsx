import { PageHeader } from "@/components/page-header";
import { SimulatorForm } from "@/components/simulator-form";

export const metadata = { title: "Routing simulator" };

export default function SimulatorPage() {
  return (
    <>
      <PageHeader
        description="Maximize comparative risk-adjusted APY subject to visible eligibility, liquidity, confidence, chain, category, and concentration constraints."
        eyebrow="Deterministic optimizer"
        title="Build an analytical route, not a transaction"
      />
      <SimulatorForm />
    </>
  );
}
