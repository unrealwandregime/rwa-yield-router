import { Badge } from "@rwa-yield-router/ui";
import { ArrowRight, BookOpenCheck, Database, Eye, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { LegalStrip } from "@/components/legal-strip";
import { CATEGORY_META, CATEGORY_VALUES, categorySlug } from "@/lib/constants";
import { catalogStats } from "@/lib/catalog";
import { formatPercent } from "@/lib/format";
import { getLiveCatalog } from "@/lib/live-morpho";

export default async function LandingPage() {
  const records = await getLiveCatalog();
  const stats = catalogStats();
  const featured = records.slice(0, 4);

  return (
    <>
      <section className="hero">
        <div className="hero-main">
          <Badge tone="positive">Independent analytical routing</Badge>
          <h1>Know the yield. See the risk. Plan the exit.</h1>
          <p className="hero-copy">
            Compare tokenized Treasuries, stablecoin vaults, lending markets, money-market tokens,
            gold-backed assets, and on-chain cash through one transparent methodology.
          </p>
          <div className="hero-actions">
            <Link className="button button-primary" href="/screener">
              Explore the market <ArrowRight aria-hidden size={16} />
            </Link>
            <Link className="button button-secondary" href="/simulator">
              Build an analytical route
            </Link>
          </div>
        </div>
        <aside aria-label="Sourced route preview" className="hero-terminal">
          <div className="terminal-header">
            <span>Verified catalog</span>
            <ConfidenceBadge confidence="MANUALLY_VERIFIED" />
          </div>
          <div className="terminal-body">
            {featured.map((record) => (
              <Link className="terminal-row" href={`/routes/${record.slug}`} key={record.id}>
                <span className="stack">
                  <strong>{record.productName}</strong>
                  <span className="faint">{record.routeName}</span>
                </span>
                <span className="muted">{record.chain}</span>
                <span className="unavailable">{formatPercent(record.grossApy)}</span>
              </Link>
            ))}
          </div>
        </aside>
      </section>

      <section aria-label="Product safeguards" className="trust-band">
        <div className="trust-item">
          <Eye aria-hidden size={17} /> Read-only and non-custodial
        </div>
        <div className="trust-item">
          <Database aria-hidden size={17} /> Every material value sourced
        </div>
        <div className="trust-item">
          <ShieldCheck aria-hidden size={17} /> Unknown is never scored as low risk
        </div>
        <div className="trust-item">
          <BookOpenCheck aria-hidden size={17} /> Methodology is inspectable
        </div>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Six markets, one taxonomy</span>
            <h2>Compare unlike routes without hiding the differences</h2>
          </div>
          <Link className="button button-ghost" href="/dashboard">
            Market overview <ArrowRight aria-hidden size={15} />
          </Link>
        </div>
        <div className="grid grid-3">
          {CATEGORY_VALUES.map((category) => {
            const meta = CATEGORY_META[category];
            const categoryRecords = records.filter((record) => record.category === category);
            return (
              <Link
                className="card category-card"
                href={`/category/${categorySlug(category)}`}
                key={category}
              >
                <div className="card-topline">
                  <span className="eyebrow">{meta.shortLabel}</span>
                  <span className="card-count">{categoryRecords.length} published routes</span>
                </div>
                <h3>{meta.label}</h3>
                <p>{meta.description}</p>
                <ArrowRight aria-hidden className="card-arrow" size={17} />
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Transparent inputs</span>
          <h2>Nothing silently becomes zero</h2>
          <p>
            Fees, eligibility, liquidity, and live yield remain explicitly unavailable until a
            permitted source or on-chain derivation verifies them. Stale observations keep their
            timestamps and confidence state.
          </p>
          <div className="kpi-row">
            <div>
              <strong>{stats.routes}</strong>
              <span>published routes</span>
            </div>
            <div>
              <strong>{stats.sources}</strong>
              <span>primary sources</span>
            </div>
            <div>
              <strong>{stats.gated}</strong>
              <span>admission gated</span>
            </div>
          </div>
        </article>
        <article className="panel">
          <span className="eyebrow">Deterministic simulation</span>
          <h2>Constraints first, allocation second</h2>
          <p>
            The optimizer screens jurisdiction, KYC, confidence, liquidity, lifecycle, and
            concentration constraints before allocating. If no portfolio is feasible, it returns no
            allocation and names the conflicts.
          </p>
          <Link className="source-link" href="/methodology">
            Read the complete methodology <ArrowRight aria-hidden size={13} />
          </Link>
        </article>
      </section>

      <LegalStrip />
    </>
  );
}
