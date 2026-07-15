"use client";

import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { formatTimestamp } from "@/lib/format";

const responseSchema = z.object({
  data: z.array(
    z.object({
      attemptCount: z.number(),
      channel: z.string(),
      condition: z.string(),
      deliveryId: z.uuid(),
      destinationLabel: z.string(),
      errorCategory: z.string().nullable(),
      observedUnit: z.string().nullable(),
      observedValue: z.string().nullable(),
      payload: z.unknown(),
      routeName: z.string().nullable(),
      status: z.string(),
      triggeredAt: z.string()
    })
  )
});

type InboxItem = z.infer<typeof responseSchema>["data"][number];

export function NotificationInbox() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch("/api/v1/notifications", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? responseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success) setItems(parsed.data.data);
        setLoaded(true);
      });
  }, []);

  return (
    <section className="panel">
      <span className="eyebrow">Delivery log</span>
      <h2>Recent notifications</h2>
      {!loaded ? (
        <p className="muted">Loading notification history…</p>
      ) : items.length === 0 ? (
        <p className="muted">No delivered notifications yet.</p>
      ) : (
        <ul className="plain-list">
          {items.map((item) => (
            <li className="list-row" key={item.deliveryId}>
              <span className="inline-actions">
                <Bell aria-hidden size={15} />
                <span>
                  <strong>{item.routeName ?? "Portfolio alert"}</strong>
                  <br />
                  <span className="faint">
                    {item.condition.replaceAll("_", " ")}
                    {item.observedValue === null
                      ? ""
                      : ` · ${item.observedValue} ${item.observedUnit ?? ""}`}
                    {` · ${item.channel} ${item.destinationLabel} · ${item.status} · ${item.attemptCount} attempt${item.attemptCount === 1 ? "" : "s"}`}
                    {item.errorCategory === null ? "" : ` (${item.errorCategory})`}
                  </span>
                </span>
              </span>
              <span className="faint">{formatTimestamp(item.triggeredAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
