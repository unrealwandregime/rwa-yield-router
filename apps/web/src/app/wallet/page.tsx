import { PageHeader } from "@/components/page-header";
import { WalletAnalysisForm } from "@/components/wallet-analysis-form";
import { getSupportedWalletChains } from "@/lib/wallet-analysis";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false }, title: "Read-only wallet analysis" };

export default function WalletPage() {
  const enabledChains = getSupportedWalletChains();
  return (
    <>
      <PageHeader
        description="Recognize balances in a bounded list of supported public vault contracts without signatures, approvals, pricing claims, or executable transactions."
        eyebrow="Non-custodial research"
        title="Read-only wallet analysis"
      />
      <WalletAnalysisForm enabledChains={enabledChains} />
    </>
  );
}
