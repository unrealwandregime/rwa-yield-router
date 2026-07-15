"use client";

import { DataState } from "@rwa-yield-router/ui";

export type HistoryPoint = { at: string; value: string };

export function HistoryChart({
  label,
  points,
  unit
}: {
  label: string;
  points: HistoryPoint[];
  unit: string;
}) {
  const parsed = points
    .map((point) => ({ ...point, numeric: Number(point.value) }))
    .filter((point) => Number.isFinite(point.numeric));

  if (parsed.length < 2) {
    return (
      <DataState
        description="The chart will populate after at least two validated observations. No synthetic history is generated."
        eyebrow="Historical data"
        title="Awaiting verified observations"
      />
    );
  }

  const values = parsed.map((point) => point.numeric);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum || 1;
  const coordinates = parsed
    .map((point, index) => {
      const x = (index / (parsed.length - 1)) * 100;
      const y = 100 - ((point.numeric - minimum) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div>
      <svg aria-labelledby="history-chart-title" role="img" viewBox="0 0 100 100">
        <title id="history-chart-title">{label} history</title>
        <polyline fill="none" points={coordinates} stroke="currentColor" strokeWidth="2" />
      </svg>
      <details>
        <summary>View chart data</summary>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Observed at</th>
              <th scope="col">{label}</th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((point) => (
              <tr key={point.at}>
                <td>{point.at}</td>
                <td>
                  {point.value} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
