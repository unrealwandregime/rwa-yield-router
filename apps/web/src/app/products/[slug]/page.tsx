import { Badge, Metric } from "@rwa-yield-router/ui";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { PageHeader } from "@/components/page-header";
import { RecordTable } from "@/components/record-table";
import { SourceLink } from "@/components/source-link";
import { CATEGORY_META } from "@/lib/constants";
import { formatPercent, formatTimestamp } from "@/lib/format";
import { getLiveCatalog, getLiveProductCatalogRecord } from "@/lib/live-morpho";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const record = await getLiveProductCatalogRecord((await params).slug);
  return record ? { title: `${record.productName} product research` } : {};
}

export default async function ProductDetailPage({ params }: PageProps) {
  const record = await getLiveProductCatalogRecord((await params).slug);
  if (!record) notFound();
  const routes = (await getLiveCatalog()).filter(
    (candidate) => candidate.productSlug === record.productSlug
  );

  return (
    <>
      <PageHeader
        description={`Underlying product research separated from the specific ways it may be held, minted, redeemed, lent, or vaulted.`}
        eyebrow={CATEGORY_META[record.category].label}
        title={record.productName}
      />
      <div className="inline-actions" style={{ flexWrap: "wrap", marginBottom: 24 }}>
        <Badge>{record.symbol}</Badge>
        <Badge tone={record.publicationStatus === "PUBLISHED" ? "positive" : "warning"}>
          {record.publicationStatus === "PUBLISHED" ? "Admitted" : "Research only"}
        </Badge>
        <ConfidenceBadge confidence={record.confidence} />
      </div>
      {record.publicationStatus !== "PUBLISHED" ? (
        <div className="notice notice-warning" role="status">
          <strong>Route admission is pending.</strong> Product metadata is sourced, while
          chain-specific contract and live-state evidence remain gated. This record cannot enter
          routing calculations.
        </div>
      ) : null}
      <div className="metric-grid">
        <Metric
          detail="Unless a verified issuer mechanism states otherwise"
          label="Native yield"
          value={formatPercent(record.nativeYield)}
        />
        <Metric
          detail="Separate from yield"
          label="Return exposure"
          value={record.category === "GOLD_BACKED_TOKEN" ? "Gold price" : record.underlyingAsset}
        />
        <Metric
          detail="Jurisdiction and investor status apply"
          label="Eligibility"
          value={record.eligibilitySummary}
        />
        <Metric
          detail={formatTimestamp(record.verifiedAt)}
          label="Identity verified"
          value={record.source.name}
        />
      </div>
      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Product identity</span>
          <h2>Issuer and underlying</h2>
          <dl className="detail-list">
            <div>
              <dt>Issuer</dt>
              <dd>{record.issuer}</dd>
            </div>
            <div>
              <dt>Underlying asset</dt>
              <dd>{record.underlyingAsset}</dd>
            </div>
            <div>
              <dt>Category</dt>
              <dd>{CATEGORY_META[record.category].label}</dd>
            </div>
            <div>
              <dt>Official source</dt>
              <dd>
                <SourceLink name={record.source.name} url={record.source.url} />
              </dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="eyebrow">Product safeguards</span>
          <h2>Research status</h2>
          <p>
            Product identity is sourced. Route-specific APY, smart-contract exposure, liquidity,
            redemption, and access terms belong to each route below and may have different evidence
            or restrictions.
          </p>
        </article>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Access paths</span>
            <h2>Sourced routes for this product</h2>
          </div>
        </div>
        <RecordTable records={routes} />
      </section>
    </>
  );
}
