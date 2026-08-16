import { Badge } from "@rwa-yield-router/ui";
import Link from "next/link";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { CATEGORY_META } from "@/lib/constants";
import type { CatalogRecord } from "@/lib/catalog";
import { formatPercent, formatRisk, formatTimestamp, formatUsd } from "@/lib/format";

export function RecordTable({ records }: { records: CatalogRecord[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">
          Sourced research routes with admission and latest analytical state
        </caption>
        <thead>
          <tr>
            <th scope="col">Product / route</th>
            <th scope="col">Category</th>
            <th scope="col">Chain</th>
            <th className="numeric" scope="col">
              Gross APY
            </th>
            <th className="numeric" scope="col">
              Net APY
            </th>
            <th scope="col">Risk</th>
            <th className="numeric" scope="col">
              AUM / TVL
            </th>
            <th scope="col">Access</th>
            <th scope="col">Confidence</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id}>
              <td>
                <Link className="stack" href={`/routes/${record.slug}`}>
                  <strong>
                    {record.productName} <span className="faint mono">{record.symbol}</span>
                  </strong>
                  <span className="faint">{record.routeName}</span>
                </Link>
              </td>
              <td>{CATEGORY_META[record.category].shortLabel}</td>
              <td>
                <Badge>{record.chain}</Badge>
              </td>
              <td className="numeric">{formatPercent(record.grossApy)}</td>
              <td className="numeric">{formatPercent(record.netApy)}</td>
              <td>{formatRisk(record.riskScore)}</td>
              <td className="numeric">{formatUsd(record.aumTvlUsd)}</td>
              <td>{record.accessMethod.replaceAll("_", " ")}</td>
              <td>
                <ConfidenceBadge confidence={record.confidence} />
              </td>
              <td>{formatTimestamp(record.observedAt ?? record.verifiedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
