import { RISK_BANDS, RISK_FACTORS, type RiskFactor } from "@rwa-yield-router/risk-engine";
import { Badge } from "@rwa-yield-router/ui";
import { PageHeader } from "@/components/page-header";
import { CATEGORY_META, CATEGORY_VALUES } from "@/lib/constants";
import { getEffectiveMethodology } from "@/lib/public-read-model";

export const metadata = { title: "Risk and yield methodology" };

const factorLabels = {
  CHAIN: "Chain",
  CONCENTRATION: "Concentration",
  CUSTODY: "Custody",
  DATA_QUALITY: "Data quality",
  GOVERNANCE_AND_UPGRADEABILITY: "Governance / upgradeability",
  INCENTIVE_DEPENDENCY: "Incentive dependency",
  ISSUER_OR_COUNTERPARTY: "Issuer / counterparty",
  LEGAL_AND_ELIGIBILITY_UNCERTAINTY: "Legal / eligibility",
  LIQUIDITY: "Liquidity",
  MARKET_PRICE: "Market price",
  OPERATIONAL: "Operational",
  ORACLE: "Oracle",
  REDEMPTION: "Redemption",
  SMART_CONTRACT: "Smart contract",
  STABLECOIN_OR_DEPEG: "Stablecoin / depeg",
  YIELD_INSTABILITY: "Yield instability"
} as const satisfies Record<RiskFactor, string>;

export default async function MethodologyPage() {
  const effective = await getEffectiveMethodology();
  if (effective === null) {
    return (
      <>
        <PageHeader
          description="The database does not contain a complete currently effective published methodology. Scores and optimizer rankings fail closed until a reviewed methodology and all category weights are published."
          eyebrow="Methodology unavailable"
          title="Comparative risk calculations are temporarily unavailable"
        />
        <section className="panel" role="status">
          <h2>No compatible publication</h2>
          <p>
            Public catalog identity remains visible, but no static production weights are silently
            substituted for missing or incompatible database methodology evidence.
          </p>
        </section>
      </>
    );
  }

  const methodology = effective.methodology;
  return (
    <>
      <PageHeader
        description="A versioned, inspectable comparative framework. Higher risk scores mean higher comparative risk; penalties are ranking adjustments, not expected-loss forecasts."
        eyebrow={`Methodology ${methodology.semanticVersion}`}
        title="How yield, uncertainty, and comparative risk are calculated"
      />
      <div className="inline-actions" style={{ flexWrap: "wrap", marginBottom: 28 }}>
        <Badge tone="positive">Published</Badge>
        <Badge>Deterministic</Badge>
        <Badge>Source-linked</Badge>
        <Badge>
          {effective.source === "DATABASE" ? "Database effective" : "Development fallback"}
        </Badge>
      </div>

      <section className="grid grid-3">
        <article className="panel">
          <span className="eyebrow">1 · Net yield</span>
          <h2>Holding-period aware</h2>
          <p>
            Gross APY is decomposed into compatible economic components. Known recurring and
            transaction costs are annualized for the selected horizon. Unknown material fees make
            net APY incomplete rather than zero.
          </p>
          <pre className="formula">
            net APY = gross APY − annual fees − annualized transaction costs
          </pre>
        </article>
        <article className="panel">
          <span className="eyebrow">2 · Composite risk</span>
          <h2>{RISK_FACTORS.length} visible factors</h2>
          <p>
            Each available factor is scored 0–100 from cited inputs. A positively weighted factor
            without sufficient evidence uses the published conservative proxy of{" "}
            {methodology.unknownRiskProxy}. Minimum evidence coverage is{" "}
            {methodology.minimumEvidenceCoveragePct}%.
          </p>
          <pre className="formula">composite = Σ(weight × effective factor) ÷ 100</pre>
        </article>
        <article className="panel">
          <span className="eyebrow">3 · Comparative adjustment</span>
          <h2>Transparent penalty groups</h2>
          <p>
            The published quadratic penalty budget is {methodology.maxAnnualPenaltyPp} annual
            percentage points. Liquidity, redemption, issuer, custody, smart-contract,
            concentration, instability, incentives, market/depeg, and data-quality effects remain
            separately explainable.
          </p>
          <pre className="formula">penalty = budget × weight share × (severity ÷ 100)²</pre>
        </article>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Category-specific exposure</span>
            <h2>Effective published factor weights</h2>
            <p>
              Version {methodology.semanticVersion}, effective {methodology.effectiveAt}. Each
              category column totals exactly 100%.
            </p>
          </div>
        </div>
        <div
          aria-label="Risk factor weights by product category"
          className="table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="data-table">
            <caption className="sr-only">Risk factor weights by product category</caption>
            <thead>
              <tr>
                <th scope="col">Risk factor</th>
                {CATEGORY_VALUES.map((category) => (
                  <th className="numeric" key={category} scope="col">
                    {CATEGORY_META[category].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {RISK_FACTORS.map((factor) => (
                <tr key={factor}>
                  <th scope="row">{factorLabels[factor]}</th>
                  {CATEGORY_VALUES.map((category) => (
                    <td className="numeric" key={`${factor}-${category}`}>
                      {methodology.categoryWeights[category][factor]}%
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                {CATEGORY_VALUES.map((category) => (
                  <td className="numeric" key={category}>
                    <strong>100%</strong>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Risk interpretation</span>
          <h2>Comparative bands</h2>
          <dl className="detail-list">
            {RISK_BANDS.map((band, index) => (
              <div key={band.code}>
                <dt>{index === 0 ? `0–${band.maximum}` : `up to ${band.maximum}`}</dt>
                <dd>{band.label}</dd>
              </div>
            ))}
          </dl>
          <p>
            Scores compare routes under the same published methodology. They are not probabilities,
            credit ratings, or statements that a product is safe.
          </p>
        </article>
        <article className="panel">
          <span className="eyebrow">Hard exclusions</span>
          <h2>Some uncertainty cannot be optimized around</h2>
          <p>
            Standard simulations exclude ineligible, paused, closed, stale-critical, unavailable,
            unpublished, unverified, and methodology-incompatible routes. Constraints are not
            weakened silently.
          </p>
        </article>
      </section>

      <section className="section panel">
        <span className="eyebrow">Required label</span>
        <h2>Comparative risk-adjusted APY</h2>
        <p>
          This is net APY minus visible comparative ranking penalties. It is not an expected return,
          realized-return forecast, probability of loss, actuarial model, or guarantee. Negative
          results are valid. When net APY or a compatible risk calculation is unavailable, the
          comparative value is also unavailable.
        </p>
      </section>
    </>
  );
}
