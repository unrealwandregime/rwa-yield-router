"use client";

import { Badge } from "@rwa-yield-router/ui";
import { Download, GitCompareArrows, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { confidenceClassificationSchema } from "@rwa-yield-router/domain";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { SavedViewsManager } from "@/components/saved-views-manager";
import { CATEGORY_META, CATEGORY_VALUES } from "@/lib/constants";
import type { CatalogRecord } from "@/lib/catalog";
import { csvSafe, formatPercent, formatRisk, formatTimestamp, formatUsd } from "@/lib/format";
import {
  SCREENER_COLUMN_LABELS,
  SCREENER_COLUMN_VALUES,
  screenerSortKeySchema,
  type SavedViewState,
  type ScreenerColumn,
  type ScreenerSortKey
} from "@/lib/saved-research-contract";

const PAGE_SIZE = 25;

const toComparable = (value: string | null, missing: number): number => {
  if (value === null) return missing;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : missing;
};

export function ScreenerClient({
  records,
  savedViewsEnabled
}: {
  records: CatalogRecord[];
  savedViewsEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<string[]>([]);
  const [visibleColumns, setVisibleColumns] = useState<readonly ScreenerColumn[]>([
    ...SCREENER_COLUMN_VALUES
  ]);
  const query = searchParams.get("q") ?? "";
  const category = searchParams.get("category") ?? "ALL";
  const chain = searchParams.get("chain") ?? "ALL";
  const confidence = searchParams.get("confidence") ?? "ALL";
  const requestedAdmission = searchParams.get("admission");
  const admission =
    requestedAdmission === "ALL" || requestedAdmission === "RESEARCH"
      ? requestedAdmission
      : "ADMITTED";
  const parsedConfidence = confidenceClassificationSchema.safeParse(confidence);
  const savedConfidence = parsedConfidence.success ? parsedConfidence.data : null;
  const parsedSort = screenerSortKeySchema.safeParse(searchParams.get("sort") ?? "product");
  const sort: ScreenerSortKey = parsedSort.success ? parsedSort.data : "product";
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
  const visible = useMemo(() => new Set(visibleColumns), [visibleColumns]);
  const currentView: SavedViewState = useMemo(
    () => ({
      filters: {
        category: CATEGORY_VALUES.find((value) => value === category) ?? null,
        chain: chains.includes(chain) ? chain : null,
        confidence:
          savedConfidence !== null && confidences.includes(savedConfidence)
            ? savedConfidence
            : null,
        query: query.slice(0, 120)
      },
      sort: { key: sort },
      visibleColumns: [...visibleColumns]
    }),
    [category, chain, chains, confidences, query, savedConfidence, sort, visibleColumns]
  );

  const applyView = (view: SavedViewState) => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("page");
    for (const name of ["q", "category", "chain", "confidence", "sort"]) next.delete(name);
    if (view.filters.query !== "") next.set("q", view.filters.query);
    if (view.filters.category !== null) next.set("category", view.filters.category);
    if (view.filters.chain !== null) next.set("chain", view.filters.chain);
    if (view.filters.confidence !== null) next.set("confidence", view.filters.confidence);
    if (view.sort.key !== "product") next.set("sort", view.sort.key);
    setVisibleColumns([...view.visibleColumns]);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  const toggleColumn = (column: ScreenerColumn) => {
    setVisibleColumns((current) => {
      if (current.includes(column)) {
        return current.length === 1 ? current : current.filter((value) => value !== column);
      }
      return SCREENER_COLUMN_VALUES.filter((value) => value === column || current.includes(value));
    });
  };

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
        (confidence === "ALL" || record.confidence === confidence) &&
        (admission === "ALL" ||
          (admission === "RESEARCH"
            ? record.publicationStatus === "GATED"
            : record.publicationStatus === "PUBLISHED"))
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
  }, [admission, category, chain, confidence, query, records, sort]);

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
              maxLength={120}
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
        <label className="field">
          <span className="sr-only">Admission status</span>
          <select
            className="select"
            onChange={(event) => setParam("admission", event.currentTarget.value)}
            value={admission}
          >
            <option value="ADMITTED">Admitted routes</option>
            <option value="ALL">All research records</option>
            <option value="RESEARCH">Research only</option>
          </select>
        </label>
        <button className="button button-secondary" onClick={exportCsv} type="button">
          <Download aria-hidden size={15} /> CSV
        </button>
      </div>

      <div className="inline-actions" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="muted" role="status" style={{ fontSize: 12 }}>
          {filtered.length} {admission === "ADMITTED" ? "admitted" : "sourced"} route
          {filtered.length === 1 ? "" : "s"} · page {Math.min(page, pageCount)} of {pageCount}
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

      <details className="panel" style={{ marginBottom: 12 }}>
        <summary>
          Visible columns ({visibleColumns.length}/{SCREENER_COLUMN_VALUES.length})
        </summary>
        <div className="form-grid" style={{ marginTop: 14 }}>
          {SCREENER_COLUMN_VALUES.map((column) => (
            <label className="field" key={column} style={{ flexDirection: "row" }}>
              <input
                checked={visible.has(column)}
                disabled={visibleColumns.length === 1 && visible.has(column)}
                onChange={() => toggleColumn(column)}
                type="checkbox"
              />
              <span>{SCREENER_COLUMN_LABELS[column]}</span>
            </label>
          ))}
        </div>
      </details>

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
                {visible.has("product") ? <th scope="col">Product / route</th> : null}
                {visible.has("category") ? <th scope="col">Category</th> : null}
                {visible.has("issuer") ? <th scope="col">Issuer / protocol</th> : null}
                {visible.has("underlying") ? <th scope="col">Underlying</th> : null}
                {visible.has("yieldSource") ? <th scope="col">Yield source</th> : null}
                {visible.has("chain") ? <th scope="col">Chain</th> : null}
                {visible.has("grossApy") ? (
                  <th className="numeric" scope="col">
                    Gross APY
                  </th>
                ) : null}
                {visible.has("netApy") ? (
                  <th className="numeric" scope="col">
                    Net APY
                  </th>
                ) : null}
                {visible.has("riskAdjustedApy") ? (
                  <th className="numeric" scope="col">
                    Risk-adj. APY
                  </th>
                ) : null}
                {visible.has("risk") ? <th scope="col">Risk</th> : null}
                {visible.has("aumTvl") ? (
                  <th className="numeric" scope="col">
                    AUM / TVL
                  </th>
                ) : null}
                {visible.has("liquidity") ? (
                  <th className="numeric" scope="col">
                    Liquidity
                  </th>
                ) : null}
                {visible.has("redemption") ? <th scope="col">Redemption</th> : null}
                {visible.has("eligibility") ? <th scope="col">KYC / eligibility</th> : null}
                {visible.has("confidence") ? <th scope="col">Confidence</th> : null}
                {visible.has("admission") ? <th scope="col">Admission</th> : null}
                {visible.has("updated") ? <th scope="col">Updated</th> : null}
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
                  {visible.has("product") ? (
                    <td>
                      <Link className="stack" href={`/routes/${record.slug}`}>
                        <strong>
                          {record.productName} <span className="faint mono">{record.symbol}</span>
                        </strong>
                        <span className="faint">{record.routeName}</span>
                      </Link>
                    </td>
                  ) : null}
                  {visible.has("category") ? (
                    <td>{CATEGORY_META[record.category].shortLabel}</td>
                  ) : null}
                  {visible.has("issuer") ? <td>{record.protocol ?? record.issuer}</td> : null}
                  {visible.has("underlying") ? <td>{record.underlyingAsset}</td> : null}
                  {visible.has("yieldSource") ? (
                    <td>{record.yieldSource.replaceAll("_", " ")}</td>
                  ) : null}
                  {visible.has("chain") ? (
                    <td>
                      <Badge>{record.chain}</Badge>
                    </td>
                  ) : null}
                  {visible.has("grossApy") ? (
                    <td className="numeric">{formatPercent(record.grossApy)}</td>
                  ) : null}
                  {visible.has("netApy") ? (
                    <td className="numeric">{formatPercent(record.netApy)}</td>
                  ) : null}
                  {visible.has("riskAdjustedApy") ? (
                    <td className="numeric">{formatPercent(record.riskAdjustedApy)}</td>
                  ) : null}
                  {visible.has("risk") ? <td>{formatRisk(record.riskScore)}</td> : null}
                  {visible.has("aumTvl") ? (
                    <td className="numeric">{formatUsd(record.aumTvlUsd)}</td>
                  ) : null}
                  {visible.has("liquidity") ? (
                    <td className="numeric">{formatUsd(record.liquidityUsd)}</td>
                  ) : null}
                  {visible.has("redemption") ? <td>{record.redemptionSummary}</td> : null}
                  {visible.has("eligibility") ? (
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
                  ) : null}
                  {visible.has("confidence") ? (
                    <td>
                      <ConfidenceBadge confidence={record.confidence} />
                    </td>
                  ) : null}
                  {visible.has("admission") ? (
                    <td>
                      <Badge
                        tone={record.publicationStatus === "PUBLISHED" ? "positive" : "warning"}
                      >
                        {record.publicationStatus === "PUBLISHED" ? "Admitted" : "Research only"}
                      </Badge>
                    </td>
                  ) : null}
                  {visible.has("updated") ? (
                    <td>{formatTimestamp(record.observedAt ?? record.verifiedAt)}</td>
                  ) : null}
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
      <section className="section">
        <SavedViewsManager current={currentView} enabled={savedViewsEnabled} onApply={applyView} />
      </section>
    </>
  );
}
