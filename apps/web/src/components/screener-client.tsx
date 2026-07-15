"use client";

import { Badge } from "@rwa-yield-router/ui";
import { Download, GitCompareArrows, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { CATEGORY_META, CATEGORY_VALUES } from "@/lib/constants";
import type { CatalogRecord } from "@/lib/catalog";
import { csvSafe, formatPercent, formatRisk, formatTimestamp, formatUsd } from "@/lib/format";

type SortKey = "product" | "grossApy" | "riskAdjustedApy" | "risk" | "recent";
const sortKeySchema = z.enum(["product", "grossApy", "riskAdjustedApy", "risk", "recent"]);

const PAGE_SIZE = 25;

const toComparable = (value: string | null, missing: number): number => {
  if (value === null) return missing;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : missing;
};

export function ScreenerClient({ records }: { records: CatalogRecord[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const query = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "ALL";
  const chain = searchParams.get("chain") ?? "ALL";
  const confidence = searchParams.get("confidence") ?? "ALL";
  const parsedSort = sortKeySchema.safeParse(searchParams.get("sort") ?? "product");
  const sort: SortKey = parsedSort.success ? parsedSort.data : "product";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);

  const setParam = (name: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "" || value === "ALL" || (name === "page" && value === "1")) next.delete(name);
    else next.set(name, value);
    if (name !== "page") next.delete("page");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const chains = useMemo(
    () => [...new Set(records.map((record) => record.chain))].sort(),
    [records]
  );
  const confidences = useMemo(
    () => [...new Set(records.map((record) => record.confidence))].sort(),
    [records]
  );

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = records.filter((record) => {
      const haystack = [
        record.productName,
        record.symbol,
        record.routeName,
        record.issuer,
        record.protocol ?? "",
        record.underlyingAsset
      ]
        .join(" ")
        .toLowerCase();
      return (
        (normalizedQuery === "" || haystack.includes(normalizedQuery)) &&
        (category === "ALL" || record.category === category) &&
        (chain === "ALL" || record.chain === chain) &&
        (confidence === "ALL" || record.confidence === confidence)
      );
    });

    return result.toSorted((a, b) => {
      switch (sort) {
        case "grossApy":
          return toComparable(b.grossApy, -Infinity) - toComparable(a.grossApy, -Infinity);
        case "riskAdjustedApy":
          return (
            toComparable(b.riskAdjustedApy, -Infinity) - toComparable(a.riskAdjustedApy, -Infinity)
          );
        case "risk":
          return toComparable(a.riskScore, Infinity) - toComparable(b.riskScore, Infinity);
        case "recent":
          return (b.observedAt ?? b.verifiedAt).localeCompare(a.observedAt ?? a.verifiedAt);
        case "product":
          return (
            a.productName.localeCompare(b.productName) || a.routeName.localeCompare(b.routeName)
          );
      }
    });
  }, [category, chain, confidence, query, records, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRecords = filtered.slice((Math.min(page, pageCount) - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSelected = (slug: string) => {
    setSelected((current) => {
      if (current.includes(slug)) return current.filter((item) => item !== slug);
      return current.length < 5 ? [...current, slug] : current;
    });
  };

  const exportCsv = () => {
    const headers = [
      "Product",
      "Symbol",
      "Route",
      "Category",
      "Issuer or protocol",
      "Chain",
      "Gross APY",
      "Net APY",
      "Comparative risk-adjusted APY",
      "Risk score",
      "AUM or TVL",
      "Available liquidity",
      "Admission status",
      "Confidence",
      "Observed at",
      "Source"
    ];
    const lines = filtered.map((record) =>
      [
        record.productName,
        record.symbol,
        record.routeName,
        CATEGORY_META[record.category].label,
        record.protocol ?? record.issuer,
        record.chain,
        record.grossApy ?? "Unavailable",
        record.netApy ?? "Unavailable",
        record.riskAdjustedApy ?? "Unavailable",
        record.riskScore ?? "Unavailable",
        record.aumTvlUsd ?? "Unavailable",
        record.liquidityUsd ?? "Unavailable",
        record.publicationStatus,
        record.confidence,
        record.observedAt ?? "Awaiting first observation",
        record.source.url
      ]
        .map(csvSafe)
        .join(",")
    );
    const blob = new Blob([[headers.map(csvSafe).join(","), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8"
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rwa-yield-router-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="filters">
        <label className="field">
          <span className="sr-only">Search products and routes</span>
          <span style={{ position: "relative" }}>
            <Search aria-hidden size={15} style={{ left: 12, position: "absolute", top: 13 }} />
            <input
              className="input"
              defaultValue={query}
              key={query}
              onChange={(event) => setParam("q", event.currentTarget.value)}
              placeholder="Search product, issuer, protocol, or asset"
              style={{ paddingLeft: 36 }}
            />
          </span>
        </label>
        <label className="field">
          <span className="sr-only">Category</span>
          <select
            className="select"
            onChange={(event) => setParam("category", event.currentTarget.value)}
            value={category}
          >
            <option value="ALL">All categories</option>
            {CATEGORY_VALUES.map((value) => (
              <option key={value} value={value}>
                {CATEGORY_META[value].label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">Chain</span>
          <select
            className="select"
            onChange={(event) => setParam("chain", event.currentTarget.value)}
            value={chain}
          >
            <option value="ALL">All chains</option>
            {chains.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="sr-only">Confidence</span>
          <select
            className="select"
            onChange={(event) => setParam("confidence", event.currentTarget.value)}
            value={confidence}
          >
            <option value="ALL">All confidence</option>
            {confidences.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <button className="button button-secondary" onClick={exportCsv} type="button">
          <Download aria-hidden size={15} /> CSV
        </button>
      </div>

      <div className="inline-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" role="status" style={{ fontSize: 12 }}>
          {filtered.length} sourced route{filtered.length === 1 ? "" : "s"} · page{" "}
          {Math.min(page, pageCount)} of {pageCount}
        </span>
        <div className="inline-actions">
          <label className="field" style={{ flexDirection: "row", alignItems: "center" }}>
            <span>Sort</span>
            <select
              className="select"
              onChange={(event) => setParam("sort", event.currentTarget.value)}
              value={sort}
            >
              <option value="product">Product</option>
              <option value="grossApy">Gross APY</option>
              <option value="riskAdjustedApy">Risk-adjusted APY</option>
              <option value="risk">Lowest risk</option>
              <option value="recent">Most recently updated</option>
            </select>
          </label>
          {selected.length > 0 ? (
            <>
              <Link
                className="button button-primary"
                href={`/compare?routes=${selected.join(",")}`}
              >
                <GitCompareArrows aria-hidden size={15} /> Compare {selected.length}
              </Link>
              <button
                aria-label="Clear comparison selection"
                className="icon-button"
                onClick={() => setSelected([])}
                type="button"
              >
                <X aria-hidden size={15} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {pageRecords.length === 0 ? (
        <div className="data-state">
          <span className="eyebrow">No results</span>
          <h2>No sourced route matches these filters</h2>
          <p>
            Clear a filter or broaden the search. Admission-gated research remains visibly labelled
            and cannot enter simulations.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">
              Yield routes with sourced status, access, confidence, and observed financial metrics
            </caption>
            <thead>
              <tr>
                <th scope="col">Compare</th>
                <th scope="col">Product / route</th>
                <th scope="col">Category</th>
                <th scope="col">Issuer / protocol</th>
                <th scope="col">Underlying</th>
                <th scope="col">Yield source</th>
                <th scope="col">Chain</th>
                <th className="numeric" scope="col">
                  Gross APY
                </th>
                <th className="numeric" scope="col">
                  Net APY
                </th>
                <th className="numeric" scope="col">
                  Risk-adj. APY
                </th>
                <th scope="col">Risk</th>
                <th className="numeric" scope="col">
                  AUM / TVL
                </th>
                <th className="numeric" scope="col">
                  Liquidity
                </th>
                <th scope="col">Redemption</th>
                <th scope="col">KYC / eligibility</th>
                <th scope="col">Confidence</th>
                <th scope="col">Admission</th>
                <th scope="col">Updated</th>
              </tr>
            </thead>
            <tbody>
              {pageRecords.map((record) => (
                <tr key={record.id}>
                  <td>
                    <input
                      aria-label={`Select ${record.productName} ${record.routeName} for comparison`}
                      checked={selected.includes(record.slug)}
                      disabled={selected.length >= 5 && !selected.includes(record.slug)}
                      onChange={() => toggleSelected(record.slug)}
                      type="checkbox"
                    />
                  </td>
                  <td>
                    <Link className="stack" href={`/routes/${record.slug}`}>
                      <strong>
                        {record.productName} <span className="faint mono">{record.symbol}</span>
                      </strong>
                      <span className="faint">{record.routeName}</span>
                    </Link>
                  </td>
                  <td>{CATEGORY_META[record.category].shortLabel}</td>
                  <td>{record.protocol ?? record.issuer}</td>
                  <td>{record.underlyingAsset}</td>
                  <td>{record.yieldSource.replaceAll("_", " ")}</td>
                  <td>
                    <Badge>{record.chain}</Badge>
                  </td>
                  <td className="numeric">{formatPercent(record.grossApy)}</td>
                  <td className="numeric">{formatPercent(record.netApy)}</td>
                  <td className="numeric">{formatPercent(record.riskAdjustedApy)}</td>
                  <td>{formatRisk(record.riskScore)}</td>
                  <td className="numeric">{formatUsd(record.aumTvlUsd)}</td>
                  <td className="numeric">{formatUsd(record.liquidityUsd)}</td>
                  <td>{record.redemptionSummary}</td>
                  <td>
                    <span className="stack">
                      <span>
                        KYC{" "}
                        {record.kycRequired === null
                          ? "unknown"
                          : record.kycRequired
                            ? "required"
                            : "not required"}
                      </span>
                      <span className="faint">{record.eligibilitySummary}</span>
                    </span>
                  </td>
                  <td>
                    <ConfidenceBadge confidence={record.confidence} />
                  </td>
                  <td>
                    <Badge tone={record.publicationStatus === "PUBLISHED" ? "positive" : "warning"}>
                      {record.publicationStatus === "PUBLISHED" ? "Admitted" : "Research only"}
                    </Badge>
                  </td>
                  <td>{formatTimestamp(record.observedAt ?? record.verifiedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pageCount > 1 ? (
        <nav
          aria-label="Screener pagination"
          className="inline-actions"
          style={{ justifyContent: "center", marginTop: 18 }}
        >
          <button
            className="button button-secondary"
            disabled={page <= 1}
            onClick={() => setParam("page", String(page - 1))}
            type="button"
          >
            Previous
          </button>
          <button
            className="button button-secondary"
            disabled={page >= pageCount}
            onClick={() => setParam("page", String(page + 1))}
            type="button"
          >
            Next
          </button>
        </nav>
      ) : null}
    </>
  );
}
