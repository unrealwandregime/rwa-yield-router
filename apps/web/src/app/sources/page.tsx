import { Badge, Metric } from "@rwa-yield-router/ui";
import { PageHeader } from "@/components/page-header";
import { SourceLink } from "@/components/source-link";
import { catalogStats, getCatalogSources } from "@/lib/catalog";

export const metadata = { title: "Data sources and confidence" };

const precedence = [
  ["1", "Official issuer or protocol API", "VERIFIED OFFICIAL / DIRECT API"],
  ["2", "On-chain derivation from verified contracts", "ONCHAIN DERIVED"],
  ["3", "Recognized third-party API with compatible terms", "THIRD PARTY"],
  ["4", "Manually curated sourced record", "MANUALLY VERIFIED"],
  ["5", "No suitable current evidence", "UNAVAILABLE"]
];

export default function SourcesPage() {
  const sources = getCatalogSources();
  const stats = catalogStats();
  return (
    <>
      <PageHeader
        description="Every published material value carries a source, economic timestamp, fetch time, verification state, confidence class, unit, status, and adapter version."
        eyebrow="Provenance policy"
        title="Sources are evidence, not decoration"
      />
      <div className="metric-grid">
        <Metric detail="Distinct canonical URLs" label="Catalog sources" value={sources.length} />
        <Metric
          detail="Visible in public research"
          label="Published routes"
          value={stats.published}
        />
        <Metric
          detail="Not eligible for default routing"
          label="Admission gated"
          value={stats.gated}
        />
        <Metric detail="Never substituted with zero" label="Missing values" value="Unavailable" />
      </div>

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Selection order</span>
          <h2>Metric-specific source precedence</h2>
          <dl className="detail-list">
            {precedence.map(([rank, name, confidence]) => (
              <div key={rank}>
                <dt>
                  {rank} · {name}
                </dt>
                <dd>
                  <Badge>{confidence}</Badge>
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Freshness, metric fitness, provider health, and material conflicts can prevent a
            higher-priority observation from being selected. Alternatives remain in the audit trail.
          </p>
        </article>
        <article className="panel">
          <span className="eyebrow">Freshness policy</span>
          <h2>Different facts age differently</h2>
          <dl className="detail-list">
            <div>
              <dt>Price</dt>
              <dd>5 minutes</dd>
            </div>
            <div>
              <dt>DeFi APY / liquidity / utilization</dt>
              <dd>15 minutes</dd>
            </div>
            <div>
              <dt>TVL</dt>
              <dd>30 minutes</dd>
            </div>
            <div>
              <dt>NAV / issuer AUM</dt>
              <dd>Source publication cadence</dd>
            </div>
            <div>
              <dt>Eligibility / legal metadata</dt>
              <dd>Weekly review</dd>
            </div>
            <div>
              <dt>Risk</dt>
              <dd>On change and at least hourly</dd>
            </div>
          </dl>
          <p>
            Stale values remain labelled with their original observation time. A fallback never
            inherits the failed source’s confidence.
          </p>
        </article>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Primary registry</span>
            <h2>Official and reviewed catalog sources</h2>
            <p>
              Live metrics may use additional adapter-specific observations recorded at ingestion
              time.
            </p>
          </div>
        </div>
        <div className="grid grid-3">
          {sources.map((source) => (
            <article className="card" key={source.url}>
              <Badge>{source.type.replaceAll("_", " ")}</Badge>
              <h3 style={{ marginTop: 15 }}>{source.name}</h3>
              <p>
                Canonical product, protocol, transparency, deployment, or operating documentation.
              </p>
              <SourceLink name="Open primary source" url={source.url} />
            </article>
          ))}
        </div>
      </section>

      <section className="section panel">
        <span className="eyebrow">Redistribution boundary</span>
        <h2>Unavailable beats unlicensed</h2>
        <p>
          Providers whose terms do not clearly permit production redistribution remain disabled
          until permission is confirmed. The product does not scrape disallowed sources, bypass rate
          limits, or publish subscription datasets. A missing permitted source produces an explicit
          unavailable, stale, estimated, or awaiting-verification state.
        </p>
      </section>
    </>
  );
}
