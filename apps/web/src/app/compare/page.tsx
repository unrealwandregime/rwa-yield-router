import { DataState } from "@rwa-yield-router/ui";
import Link from "next/link";
import { ComparisonPicker } from "@/components/comparison-picker";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { LegalStrip } from "@/components/legal-strip";
import { PageHeader } from "@/components/page-header";
import { CATEGORY_META } from "@/lib/constants";
import { type CatalogRecord } from "@/lib/catalog";
import { formatPercent, formatRisk, formatTimestamp, formatUsd } from "@/lib/format";
import { getLiveCatalog } from "@/lib/live-morpho";

export const metadata = { title: "Compare routes" };

type PageProps = { searchParams: Promise<{ routes?: string }> };

const comparisonNarrative = (records: CatalogRecord[]): string => {
  const withGrossApy = records.filter((record) => record.grossApy !== null);
  if (withGrossApy.length < 2) {
    return `Current APY cannot be compared because fewer than two selected routes have validated live observations. The table still compares sourced access, redemption, yield-source, chain, and confidence fields.`;
  }
  const sorted = withGrossApy.toSorted((a, b) => Number(b.grossApy) - Number(a.grossApy));
  const first = sorted[0];
  const second = sorted[1];
  if (!first || !second || first.grossApy === null || second.grossApy === null)
    return "APY comparison is unavailable.";
  const difference = (Number(first.grossApy) - Number(second.grossApy)).toFixed(2);
  return `${first.productName} via ${first.routeName} has ${difference} percentage points more sourced gross APY than ${second.productName} via ${second.routeName}. This difference does not account for unavailable fees, eligibility, or liquidity unless those fields are shown as verified below.`;
};

export default async function ComparePage({ searchParams }: PageProps) {
  const catalog = await getLiveCatalog();
  const slugs = ((await searchParams).routes ?? "").split(",").filter(Boolean).slice(0, 5);
  const records = slugs
    .map((slug) => catalog.find((record) => record.slug === slug))
    .filter((record): record is CatalogRecord => record !== undefined);

  return (
    <>
      <PageHeader
        description="Inspect up to five routes side by side. Every deterministic sentence is derived only from the displayed fields."
        eyebrow="Comparison engine"
        title="Compare yield without losing the context"
      />
      <LegalStrip compact />
      {records.length < 2 ? (
        <>
          <DataState
            description="Choose at least two sourced routes. Research-only admission status remains visible in the comparison."
            eyebrow="Selection required"
            title="Build a comparison"
          />
          <section className="section">
            <ComparisonPicker records={catalog} />
          </section>
        </>
      ) : (
        <>
          <section className="panel comparison-narrative">
            <span className="eyebrow">Deterministic reading</span>
            <h2>What the displayed evidence supports</h2>
            <p>{comparisonNarrative(records)}</p>
          </section>
          <section className="section">
            <div className="table-wrap">
              <table className="data-table comparison-table">
                <caption className="sr-only">Side-by-side comparison of selected routes</caption>
                <thead>
                  <tr>
                    <th scope="col">Field</th>
                    {records.map((record) => (
                      <th scope="col" key={record.id}>
                        <Link href={`/routes/${record.slug}`}>
                          {record.productName}
                          <br />
                          <span className="faint">{record.routeName}</span>
                        </Link>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Category</th>
                    {records.map((record) => (
                      <td key={record.id}>{CATEGORY_META[record.category].label}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Gross APY</th>
                    {records.map((record) => (
                      <td className="numeric" key={record.id}>
                        {formatPercent(record.grossApy)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Net APY</th>
                    {records.map((record) => (
                      <td className="numeric" key={record.id}>
                        {formatPercent(record.netApy)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Comparative risk-adjusted APY</th>
                    {records.map((record) => (
                      <td className="numeric" key={record.id}>
                        {formatPercent(record.riskAdjustedApy)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Risk</th>
                    {records.map((record) => (
                      <td key={record.id}>{formatRisk(record.riskScore)}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Yield source</th>
                    {records.map((record) => (
                      <td key={record.id}>{record.yieldSource.replaceAll("_", " ")}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Incentive dependency</th>
                    {records.map((record) => (
                      <td key={record.id}>Awaiting component observation</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">AUM / TVL</th>
                    {records.map((record) => (
                      <td className="numeric" key={record.id}>
                        {formatUsd(record.aumTvlUsd)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Available liquidity</th>
                    {records.map((record) => (
                      <td className="numeric" key={record.id}>
                        {formatUsd(record.liquidityUsd)}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Redemption</th>
                    {records.map((record) => (
                      <td key={record.id}>{record.redemptionSummary}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">KYC</th>
                    {records.map((record) => (
                      <td key={record.id}>
                        {record.kycRequired === null
                          ? "Unknown"
                          : record.kycRequired
                            ? "Required"
                            : "Not required"}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Eligibility</th>
                    {records.map((record) => (
                      <td key={record.id}>{record.eligibilitySummary}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Issuer / protocol</th>
                    {records.map((record) => (
                      <td key={record.id}>{record.protocol ?? record.issuer}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Chain</th>
                    {records.map((record) => (
                      <td key={record.id}>{record.chain}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Confidence</th>
                    {records.map((record) => (
                      <td key={record.id}>
                        <ConfidenceBadge confidence={record.confidence} />
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">Updated</th>
                    {records.map((record) => (
                      <td key={record.id}>
                        {formatTimestamp(record.observedAt ?? record.verifiedAt)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          <div className="inline-actions" style={{ justifyContent: "center", marginTop: 18 }}>
            <Link className="button button-secondary" href="/compare">
              New comparison
            </Link>
          </div>
        </>
      )}
    </>
  );
}
