"use client";

import { GitCompareArrows, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { CatalogRecord } from "@/lib/catalog";

export function ComparisonPicker({ records }: { records: CatalogRecord[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return records.slice(0, 20);
    return records
      .filter((record) =>
        `${record.productName} ${record.routeName} ${record.issuer}`
          .toLowerCase()
          .includes(normalized)
      )
      .slice(0, 20);
  }, [query, records]);

  return (
    <div className="panel">
      <label className="field">
        <span>Find up to five routes</span>
        <span style={{ position: "relative" }}>
          <Search aria-hidden size={15} style={{ left: 12, position: "absolute", top: 13 }} />
          <input
            className="input"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search product, route, or issuer"
            style={{ paddingLeft: 36 }}
            value={query}
          />
        </span>
      </label>
      <div className="comparison-picker-list">
        {filtered.map((record) => (
          <label className="comparison-picker-row" key={record.id}>
            <input
              checked={selected.includes(record.slug)}
              disabled={selected.length >= 5 && !selected.includes(record.slug)}
              onChange={() =>
                setSelected((current) =>
                  current.includes(record.slug)
                    ? current.filter((slug) => slug !== record.slug)
                    : [...current, record.slug]
                )
              }
              type="checkbox"
            />
            <span className="stack">
              <strong>{record.productName}</strong>
              <span className="faint">
                {record.routeName} · {record.chain}
              </span>
            </span>
          </label>
        ))}
      </div>
      <button
        className="button button-primary"
        disabled={selected.length < 2}
        onClick={() => router.push(`/compare?routes=${selected.join(",")}`)}
        type="button"
      >
        <GitCompareArrows aria-hidden size={15} /> Compare {selected.length || "selected"}
      </button>
    </div>
  );
}
