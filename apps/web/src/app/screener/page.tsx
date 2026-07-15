import { Suspense } from "react";
import { LegalStrip } from "@/components/legal-strip";
import { PageHeader } from "@/components/page-header";
import { ScreenerClient } from "@/components/screener-client";
import { getLiveCatalog } from "@/lib/live-morpho";

export const metadata = { title: "Universal yield screener" };

export default async function ScreenerPage() {
  const records = await getLiveCatalog();
  return (
    <>
      <PageHeader
        description="Filter sourced routes by market, chain, access, confidence, and current analytical state. Missing data is never converted to zero."
        eyebrow="Universal screener"
        title="Yield, access, liquidity, and risk in one table"
      />
      <LegalStrip compact />
      <Suspense fallback={<div className="data-state">Loading screener controls…</div>}>
        <ScreenerClient records={records} />
      </Suspense>
    </>
  );
}
