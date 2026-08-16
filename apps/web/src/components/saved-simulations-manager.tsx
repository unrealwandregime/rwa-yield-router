"use client";

import { FileText, Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { browserFetch } from "@/lib/browser-fetch";
import { formatPercent, formatRisk, formatTimestamp } from "@/lib/format";

const resultSummarySchema = z.discriminatedUnion("status", [
  z.object({
    allocations: z.array(
      z.object({
        allocationPct: z.string(),
        comparativeRiskAdjustedApy: z.string().nullable(),
        comparativeRiskAdjustedApyBeforeTransactionCosts: z.string(),
        netApy: z.string().nullable(),
        netApyBeforeTransactionCosts: z.string(),
        rationaleCodes: z.array(z.string()),
        riskScore: z.string(),
        routeId: z.string(),
        transactionCostStatus: z.enum(["AVAILABLE", "UNAVAILABLE"])
      })
    ),
    assumptions: z.array(z.string()),
    dataTimestamp: z.string(),
    methodologyVersion: z.string(),
    metrics: z
      .object({
        comparativeRiskAdjustedApy: z.string().nullable(),
        comparativeRiskAdjustedApyBeforeTransactionCosts: z.string(),
        netBlendedApy: z.string().nullable(),
        netBlendedApyBeforeTransactionCosts: z.string(),
        transactionCostStatus: z.enum(["AVAILABLE", "UNAVAILABLE"])
      })
      .passthrough(),
    status: z.literal("FEASIBLE")
  }),
  z.object({
    dataTimestamp: z.string(),
    diagnostics: z.object({
      conflicts: z.array(
        z.object({
          code: z.string(),
          label: z.string(),
          suggestedValue: z.string().nullable()
        })
      ),
      summary: z.string()
    }),
    methodologyVersion: z.string(),
    status: z.literal("INFEASIBLE")
  }),
  z.object({
    dataTimestamp: z.string(),
    methodologyVersion: z.string(),
    reason: z.string(),
    status: z.literal("UNAVAILABLE")
  })
]);

const persistedResultSchema = z.unknown().transform((value) => {
  const parsed = resultSummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
});

const responseSchema = z.object({
  data: z.array(
    z.object({
      createdAt: z.string(),
      dataCutoff: z.string(),
      grossBlendedApy: z.string().nullable(),
      id: z.string().uuid(),
      methodologyVersionId: z.string().uuid(),
      name: z.string().nullable(),
      netBlendedApy: z.string().nullable(),
      resultSummary: persistedResultSchema,
      status: z.string(),
      weightedRiskScore: z.string().nullable()
    })
  )
});

type SavedSimulation = z.infer<typeof responseSchema>["data"][number];

export function SavedSimulationsManager() {
  const [items, setItems] = useState<SavedSimulation[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/simulations/saved", { cache: "no-store" });
    if (!response.ok) return;
    const parsed = responseSchema.safeParse(await response.json());
    if (parsed.success) setItems(parsed.data.data);
  }, []);

  useEffect(() => {
    void fetch("/api/v1/simulations/saved", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? responseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success) setItems(parsed.data.data);
      });
  }, []);

  const rename = async (item: SavedSimulation) => {
    const nextName = window.prompt("Simulation name", item.name ?? "Saved simulation")?.trim();
    if (!nextName) return;
    const response = await browserFetch("/api/v1/simulations/saved", {
      body: JSON.stringify({ id: item.id, name: nextName }),
      headers: { "content-type": "application/json" },
      method: "PATCH"
    });
    setMessage(response.ok ? "Simulation renamed." : "Simulation could not be renamed.");
    if (response.ok) await load();
  };

  const remove = async (id: string) => {
    const response = await browserFetch(`/api/v1/simulations/saved?id=${encodeURIComponent(id)}`, {
      method: "DELETE"
    });
    setMessage(response.ok ? "Simulation archived." : "Simulation could not be archived.");
    if (response.ok) await load();
  };

  if (items.length === 0)
    return (
      <div className="data-state">
        <span className="eyebrow">No saved simulations</span>
        <h2>Your analytical reports will appear here</h2>
        <p>
          Run a simulation, review its sources and constraints, then save the immutable snapshot.
        </p>
        {message ? <p aria-live="polite">{message}</p> : null}
      </div>
    );

  return (
    <section className="panel">
      <span className="eyebrow">Immutable snapshots</span>
      <h2>Your saved simulations</h2>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Status</th>
              <th scope="col">Gross APY</th>
              <th scope="col">Net APY after user costs</th>
              <th scope="col">Risk</th>
              <th scope="col">Data cutoff</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <strong>{item.name ?? "Saved simulation"}</strong>
                  <br />
                  <span className="faint">Saved {formatTimestamp(item.createdAt)}</span>
                </td>
                <td>{item.status}</td>
                <td>{formatPercent(item.grossBlendedApy)}</td>
                <td>{formatPercent(item.netBlendedApy)}</td>
                <td>{formatRisk(item.weightedRiskScore)}</td>
                <td>{formatTimestamp(item.dataCutoff)}</td>
                <td>
                  <span className="inline-actions">
                    <button
                      aria-expanded={openId === item.id}
                      aria-label={`Open analytical report for ${item.name ?? "saved simulation"}`}
                      className="icon-button"
                      onClick={() => setOpenId((current) => (current === item.id ? null : item.id))}
                      type="button"
                    >
                      <FileText aria-hidden size={15} />
                    </button>
                    <button
                      aria-label="Rename simulation"
                      className="icon-button"
                      onClick={() => void rename(item)}
                      type="button"
                    >
                      <Pencil aria-hidden size={15} />
                    </button>
                    <button
                      aria-label="Archive simulation"
                      className="icon-button"
                      onClick={() => void remove(item.id)}
                      type="button"
                    >
                      <Trash2 aria-hidden size={15} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openId ? <SavedSimulationReport item={items.find((item) => item.id === openId)} /> : null}
      {message ? (
        <p aria-live="polite" className="legal-strip">
          {message}
        </p>
      ) : null}
    </section>
  );
}

function SavedSimulationReport({ item }: { item: SavedSimulation | undefined }) {
  if (item === undefined) return null;
  const result = item.resultSummary;
  return (
    <section aria-label="Saved analytical report" className="data-state">
      <span className="eyebrow">Saved analytical snapshot</span>
      <h3>{item.name ?? "Saved simulation"}</h3>
      <p className="muted">
        Data cutoff {formatTimestamp(item.dataCutoff)}. This immutable research output is not an
        instruction to transact or individualized investment advice.
      </p>
      {result === null ? (
        <p>The detailed snapshot is unavailable; the summary values above remain preserved.</p>
      ) : result.status === "FEASIBLE" ? (
        <>
          <p>
            Methodology {result.methodologyVersion} · source data{" "}
            {formatTimestamp(result.dataTimestamp)}
          </p>
          {result.assumptions.length > 0 ? (
            <div className="notice notice-warning">
              <strong>Research assumptions and data limits</strong>
              <ul>
                {result.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th scope="col">Allocation</th>
                  <th scope="col">Net APY after user costs</th>
                  <th scope="col">Provider net APY before user costs</th>
                  <th scope="col">Comparative adjusted APY before user costs</th>
                  <th scope="col">Risk</th>
                  <th scope="col">Deterministic rationale</th>
                </tr>
              </thead>
              <tbody>
                {result.allocations.map((allocation) => (
                  <tr key={allocation.routeId}>
                    <td>{allocation.routeId}</td>
                    <td>{formatPercent(allocation.allocationPct)}</td>
                    <td>{formatPercent(allocation.netApy)}</td>
                    <td>{formatPercent(allocation.netApyBeforeTransactionCosts)}</td>
                    <td>
                      {formatPercent(allocation.comparativeRiskAdjustedApyBeforeTransactionCosts)}
                    </td>
                    <td>{formatRisk(allocation.riskScore)}</td>
                    <td>
                      {allocation.rationaleCodes.join(", ").replaceAll("_", " ").toLowerCase()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : result.status === "INFEASIBLE" ? (
        <>
          <p>{result.diagnostics.summary}</p>
          <ul>
            {result.diagnostics.conflicts.map((conflict) => (
              <li key={conflict.code}>
                {conflict.label}
                {conflict.suggestedValue === null
                  ? ""
                  : ` Suggested research scenario: ${conflict.suggestedValue}.`}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>The solver did not return a valid allocation: {result.reason.replaceAll("_", " ")}.</p>
      )}
    </section>
  );
}
