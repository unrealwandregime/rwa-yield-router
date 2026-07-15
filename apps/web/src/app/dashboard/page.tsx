import { Metric } from "@rwa-yield-router/ui";
import { AlertTriangle, ArrowRight, Clock3 } from "lucide-react";
import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { PageHeader } from "@/components/page-header";
import { CATEGORY_META, CATEGORY_VALUES, categorySlug } from "@/lib/constants";
import { catalogStats } from "@/lib/catalog";
import { formatTimestamp } from "@/lib/format";
import { getLiveCatalog } from "@/lib/live-morpho";

export const metadata = { title: "Market overview" };

export default async function DashboardPage() {
  const stats = catalogStats();
  const records = await getLiveCatalog();
  const missingLive = records.filter((record) => record.observedAt === null).length;
  const latestVerification =
    records.map((record) => record.verifiedAt).sort((a, b) => b.localeCompare(a))[0] ?? null;

  return (
    <>
      <PageHeader
        actions={
          <Link className="button button-primary" href="/screener">
            Open screener <ArrowRight aria-hidden size={15} />
          </Link>
        }
        description="Coverage, freshness, and comparable route intelligence across every supported product category."
        eyebrow="Market intelligence"
        title="On-chain cash and RWA overview"
      />
      <div className="metric-grid">
        <Metric detail="Sourced catalog records" label="Published routes" value={stats.routes} />
        <Metric
          detail="Unique issuer/product pairs"
          label="Tracked products"
          value={stats.products}
        />
        <Metric
          detail="No missing value is treated as zero"
          label="Live APY awaiting"
          value={missingLive}
        />
        <Metric
          detail={formatTimestamp(latestVerification)}
          label="Catalog verification"
          value={<ConfidenceBadge confidence="MANUALLY_VERIFIED" />}
        />
      </div>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Category coverage</span>
            <h2>Published research universe</h2>
            <p>Live financial aggregates remain unavailable until their provider jobs succeed.</p>
          </div>
        </div>
        <div className="grid grid-3">
          {CATEGORY_VALUES.map((category) => {
            const meta = CATEGORY_META[category];
            const categoryRecords = records.filter((record) => record.category === category);
            const verifiedAt =
              categoryRecords
                .map((record) => record.verifiedAt)
                .sort((a, b) => b.localeCompare(a))[0] ?? null;
            return (
              <Link
                className="card category-card"
                href={`/category/${categorySlug(category)}`}
                key={category}
              >
                <div className="card-topline">
                  <span className="eyebrow">{meta.shortLabel}</span>
                  <span className="card-count">{categoryRecords.length} routes</span>
                </div>
                <h3>{meta.label}</h3>
                <div className="kpi-row">
                  <div>
                    <strong>Unavailable</strong>
                    <span>median APY</span>
                  </div>
                  <div>
                    <strong>Unavailable</strong>
                    <span>total AUM/TVL</span>
                  </div>
                </div>
                <span className="faint" style={{ fontSize: 10, marginTop: 18 }}>
                  Verified {formatTimestamp(verifiedAt)}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Data quality queue</span>
          <h2>{missingLive} routes await a current observation</h2>
          <p>
            Identity and official-source metadata are published. APY, scale, and liquidity stay
            unavailable until current adapters produce a validated observation.
          </p>
          <Link className="button button-secondary" href="/status">
            <Clock3 aria-hidden size={15} /> Inspect provider health
          </Link>
        </article>
        <article className="panel">
          <span className="eyebrow">Admission controls</span>
          <h2>{stats.gated} researched routes are not published</h2>
          <p>
            Gated records require canonical contract, legal, operational, or current-market
            confirmation. They cannot enter the default screener or optimizer.
          </p>
          <Link className="button button-secondary" href="/sources">
            <AlertTriangle aria-hidden size={15} /> Review source policy
          </Link>
        </article>
      </section>
    </>
  );
}
