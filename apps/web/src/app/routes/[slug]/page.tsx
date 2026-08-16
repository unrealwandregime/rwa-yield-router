import { Badge, Metric } from "@rwa-yield-router/ui";
import { ArrowLeft, ExternalLink, GitCompareArrows } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { HistoryChart } from "@/components/history-chart";
import { LegalStrip } from "@/components/legal-strip";
import { PageHeader } from "@/components/page-header";
import { SourceLink } from "@/components/source-link";
import { CATEGORY_META } from "@/lib/constants";
import { formatPercent, formatRisk, formatTimestamp, formatUsd } from "@/lib/format";
import { getLiveCatalogRecord } from "@/lib/live-morpho";
import { getYieldHistory } from "@/lib/history";

type PageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const record = await getLiveCatalogRecord((await params).slug);
  return record
    ? {
        title: `${record.productName} · ${record.routeName}`,
        description: `Sourced yield, liquidity, access, redemption, and comparative risk research for ${record.productName} via ${record.routeName}.`
      }
    : {};
}

const riskFactors = [
  "Liquidity",
  "Redemption",
  "Issuer / counterparty",
  "Custody",
  "Smart contract",
  "Oracle",
  "Chain",
  "Stablecoin / depeg",
  "Market price",
  "Concentration",
  "Yield instability",
  "Incentive dependency",
  "Governance / upgradeability",
  "Operational",
  "Legal / eligibility",
  "Data quality"
];

export default async function RouteDetailPage({ params }: PageProps) {
  const record = await getLiveCatalogRecord((await params).slug);
  if (!record) notFound();
  const yieldHistory = await getYieldHistory(record.slug);
  const metricEvidence = [
    { label: "Yield", state: record.metricStatus.yield },
    { label: "AUM / TVL", state: record.metricStatus.aumTvl },
    { label: "Liquidity", state: record.metricStatus.liquidity },
    { label: "Risk", state: record.metricStatus.risk }
  ] as const;
  const displayableMetricStatuses = new Set(["CURRENT", "STALE", "ESTIMATED", "DEGRADED"]);
  const materialMetricCoverage = metricEvidence.filter(({ state }) =>
    displayableMetricStatuses.has(state.status)
  ).length;
  const isMorphoProviderRate =
    record.source.url === "https://api.morpho.org/graphql" ||
    record.source.name.toLocaleLowerCase("en-US").includes("morpho");
  const usesRequestTimeOnlyEvidence =
    isMorphoProviderRate && record.observedAt !== null && record.sourceObservationIds.length === 0;

  return (
    <>
      <div className="inline-actions" style={{ marginBottom: 24 }}>
        <Link className="button button-ghost" href="/screener">
          <ArrowLeft aria-hidden size={15} /> Screener
        </Link>
      </div>
      <PageHeader
        actions={
          <>
            <Link className="button button-secondary" href={`/products/${record.productSlug}`}>
              Underlying product
            </Link>
            <Link className="button button-primary" href={`/compare?routes=${record.slug}`}>
              <GitCompareArrows aria-hidden size={15} /> Compare
            </Link>
          </>
        }
        description={`${record.routeName} on ${record.chain}. Yield and return exposure are presented separately.`}
        eyebrow={`${CATEGORY_META[record.category].label} · ${record.status}`}
        title={`${record.productName} · ${record.routeName}`}
      />
      <div className="inline-actions" style={{ flexWrap: "wrap", marginBottom: 24 }}>
        <Badge>{record.symbol}</Badge>
        <Badge>{record.chain}</Badge>
        <Badge>{record.accessMethod.replaceAll("_", " ")}</Badge>
        <Badge tone={record.publicationStatus === "PUBLISHED" ? "positive" : "warning"}>
          {record.publicationStatus === "PUBLISHED" ? "Admitted" : "Research only"}
        </Badge>
        <ConfidenceBadge confidence={record.confidence} />
      </div>
      {record.publicationStatus !== "PUBLISHED" ? (
        <div className="notice notice-warning" role="status">
          <strong>Route admission is pending.</strong> This sourced research record is visible for
          coverage, but it has not passed the canonical contract, live-state, liquidity, and access
          gates required for simulation. {record.warnings.join(" ")}
        </div>
      ) : null}
      {record.publicationStatus === "PUBLISHED" && record.warnings.length > 0 ? (
        <div className="notice notice-warning" role="status">
          <strong>Evidence limitations apply to this admitted route.</strong>
          <ul style={{ marginBottom: 0, marginTop: 10, paddingLeft: 20 }}>
            {[...new Set(record.warnings)].map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="metric-grid">
        <Metric
          detail="Current sourced route rate"
          label="Gross APY"
          value={formatPercent(record.grossApy)}
        />
        <Metric
          detail={
            isMorphoProviderRate
              ? "Provider-reported after vault fees; before user-specific transaction costs"
              : "Before user-specific entry, exit, gas, and slippage costs"
          }
          label="Net APY"
          value={formatPercent(record.netApy)}
        />
        <Metric
          detail={
            record.metricStatus.risk.status === "ESTIMATED"
              ? "Estimated comparative proxy; not a return forecast"
              : "Comparative methodology, not a return forecast"
          }
          label="Comparative risk-adjusted APY"
          value={formatPercent(record.riskAdjustedApy)}
        />
        <Metric
          detail={
            record.metricStatus.risk.status === "ESTIMATED"
              ? "Estimated with unavailable factor evidence; see warnings"
              : "Higher means higher comparative risk"
          }
          label="Risk score"
          value={formatRisk(record.riskScore)}
        />
      </div>
      <LegalStrip compact />

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Economic source</span>
          <h2>Where the return comes from</h2>
          <dl className="detail-list">
            <div>
              <dt>Yield source</dt>
              <dd>{record.yieldSource.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Native yield</dt>
              <dd>{formatPercent(record.nativeYield)}</dd>
            </div>
            <div>
              <dt>Base APY</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>Incentive APY</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd>Awaiting verified schedule</dd>
            </div>
            <div>
              <dt>Return exposure</dt>
              <dd>
                {record.category === "GOLD_BACKED_TOKEN"
                  ? "Gold-price movement; not yield"
                  : record.underlyingAsset}
              </dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="eyebrow">Scale and exit</span>
          <h2>Liquidity is not assumed</h2>
          <dl className="detail-list">
            <div>
              <dt>AUM / TVL</dt>
              <dd>{formatUsd(record.aumTvlUsd)}</dd>
            </div>
            <div>
              <dt>Available liquidity</dt>
              <dd>{formatUsd(record.liquidityUsd)}</dd>
            </div>
            <div>
              <dt>Redemption</dt>
              <dd>{record.redemptionSummary}</dd>
            </div>
            <div>
              <dt>Utilization</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>NAV premium / discount</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>{usesRequestTimeOnlyEvidence ? "Provider retrieved at" : "Observed at"}</dt>
              <dd>{formatTimestamp(record.observedAt)}</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Historical evidence</span>
            <h2>Yield history</h2>
            <p>No synthetic points are generated to fill missing history.</p>
          </div>
        </div>
        <HistoryChart label="Net APY" points={yieldHistory} unit="%" />
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Comparative framework</span>
            <h2>Risk factors</h2>
            <p>
              Unavailable factors remain unavailable. A proxy used for comparative ranking is
              labelled estimated and is never presented as observed factor evidence.
            </p>
          </div>
          <Link className="button button-secondary" href="/methodology">
            Methodology
          </Link>
        </div>
        <div className="grid grid-4">
          {riskFactors.map((factor) => (
            <div className="card" key={factor}>
              <span className="label">{factor}</span>
              <h3 style={{ marginTop: 13 }}>
                {record.metricStatus.risk.status === "ESTIMATED"
                  ? "Factor evidence not published"
                  : "Unavailable"}
              </h3>
              <p>
                This public record contains no cited factor-level result. Missing evidence is not
                treated as a zero-risk observation.
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Access</span>
          <h2>Eligibility and redemption</h2>
          <dl className="detail-list">
            <div>
              <dt>KYC</dt>
              <dd>
                {record.kycRequired === null
                  ? "Unknown"
                  : record.kycRequired
                    ? "Required"
                    : "Not required"}
              </dd>
            </div>
            <div>
              <dt>Eligibility</dt>
              <dd>{record.eligibilitySummary}</dd>
            </div>
            <div>
              <dt>Access method</dt>
              <dd>{record.accessMethod.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt>Minimum investment</dt>
              <dd>Unavailable</dd>
            </div>
            <div>
              <dt>Transfer restrictions</dt>
              <dd>Awaiting verification</dd>
            </div>
          </dl>
        </article>
        <article className="panel">
          <span className="eyebrow">Infrastructure</span>
          <h2>Parties and controls</h2>
          <dl className="detail-list">
            <div>
              <dt>Issuer</dt>
              <dd>{record.issuer}</dd>
            </div>
            <div>
              <dt>Protocol</dt>
              <dd>{record.protocol ?? "Not applicable"}</dd>
            </div>
            <div>
              <dt>Custodian</dt>
              <dd>Awaiting route-level verification</dd>
            </div>
            <div>
              <dt>Audits / reserves</dt>
              <dd>See official source; structured record pending</dd>
            </div>
            <div>
              <dt>Contract</dt>
              <dd>Canonical address admission gate applies</dd>
            </div>
          </dl>
        </article>
      </section>

      <section className="section panel">
        <span className="eyebrow">Source drawer</span>
        <h2>Material provenance</h2>
        <div className="grid grid-3" style={{ marginTop: 18 }}>
          <div>
            <span className="label">Source</span>
            <p>
              <SourceLink name={record.source.name} url={record.source.url} />
            </p>
          </div>
          <div>
            <span className="label">Source type</span>
            <p>{record.source.type.replaceAll("_", " ")}</p>
          </div>
          <div>
            <span className="label">Last verified</span>
            <p>{formatTimestamp(record.verifiedAt)}</p>
          </div>
          <div>
            <span className="label">Confidence</span>
            <p>
              <ConfidenceBadge confidence={record.confidence} />
            </p>
          </div>
          <div>
            <span className="label">
              {usesRequestTimeOnlyEvidence ? "Provider retrieved at" : "Live observation"}
            </span>
            <p>{formatTimestamp(record.observedAt)}</p>
          </div>
          <div>
            <span className="label">Official destination</span>
            <p>
              <a
                className="source-link"
                href={record.source.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                Open source <ExternalLink aria-hidden size={13} />
              </a>
            </p>
          </div>
          <div>
            <span className="label">Material metric coverage</span>
            <p>
              {materialMetricCoverage} of {metricEvidence.length} metrics have a displayable value
            </p>
          </div>
          <div>
            <span className="label">Persisted observations</span>
            <p>
              {record.sourceObservationIds.length > 0
                ? `${record.sourceObservationIds.length} referenced`
                : usesRequestTimeOnlyEvidence
                  ? "None; request-time values are not optimizer evidence"
                  : "None; persisted metric evidence is unavailable"}
            </p>
          </div>
        </div>
        <div className="grid grid-2" style={{ marginTop: 24 }}>
          <div>
            <h3>Metric evidence states</h3>
            <dl className="detail-list">
              {metricEvidence.map(({ label, state }) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>
                    {state.status.replaceAll("_", " ")} · {state.confidence.replaceAll("_", " ")}
                    {state.observedAt === null ? "" : ` · ${formatTimestamp(state.observedAt)}`}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3>Persisted observation references</h3>
            {record.sourceObservationIds.length > 0 ? (
              <ul style={{ overflowWrap: "anywhere", paddingLeft: 20 }}>
                {record.sourceObservationIds.map((observationId) => (
                  <li key={observationId}>
                    <code>{observationId}</code>
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                {usesRequestTimeOnlyEvidence
                  ? "No database observation IDs support the request-time fallback. Those values may be displayed with their provider timestamp, but they are not admitted to the optimizer."
                  : "No persisted observation IDs are available. Material values remain unavailable for optimization until matching observations are ingested."}
              </p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
