"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { browserFetch } from "@/lib/browser-fetch";
import { formatPercent, formatRisk, formatTimestamp } from "@/lib/format";

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
      resultSummary: z.unknown().nullable(),
      status: z.string(),
      weightedRiskScore: z.string().nullable()
    })
  )
});

type SavedSimulation = z.infer<typeof responseSchema>["data"][number];

export function SavedSimulationsManager() {
  const [items, setItems] = useState<SavedSimulation[]>([]);
  const [message, setMessage] = useState<string | null>(null);

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
              <th scope="col">Net APY</th>
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
      {message ? (
        <p aria-live="polite" className="legal-strip">
          {message}
        </p>
      ) : null}
    </section>
  );
}
