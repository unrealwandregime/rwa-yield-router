"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { browserFetch } from "@/lib/browser-fetch";
import type { CatalogRecord } from "@/lib/catalog";

const watchlistResponseSchema = z.object({
  data: z.array(
    z.object({
      addedAt: z.coerce.date(),
      id: z.string().uuid(),
      productName: z.string(),
      routeName: z.string(),
      routeSlug: z.string()
    })
  )
});

type WatchlistItem = z.infer<typeof watchlistResponseSchema>["data"][number];

export function WatchlistManager({ records }: { records: CatalogRecord[] }) {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/v1/watchlist", { cache: "no-store" });
    if (!response.ok) return;
    const parsed = watchlistResponseSchema.safeParse(await response.json());
    if (parsed.success) setItems(parsed.data.data);
  }, []);

  useEffect(() => {
    void fetch("/api/v1/watchlist", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? watchlistResponseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success) setItems(parsed.data.data);
      });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    const response = await browserFetch("/api/v1/watchlist", {
      body: JSON.stringify({ routeSlug: form.get("routeSlug") }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    setMessage(
      response.ok
        ? "Route added to your private watchlist."
        : "The route could not be added. Check your session and configuration."
    );
    if (response.ok) await load();
    setPending(false);
  };

  const remove = async (routeSlug: string) => {
    setPending(true);
    const response = await browserFetch(
      `/api/v1/watchlist?routeSlug=${encodeURIComponent(routeSlug)}`,
      {
        method: "DELETE"
      }
    );
    setMessage(
      response.ok ? "Route removed from your watchlist." : "The route could not be removed."
    );
    if (response.ok) await load();
    setPending(false);
  };

  return (
    <div className="grid grid-2">
      <form className="panel" onSubmit={submit}>
        <span className="eyebrow">Watchlist</span>
        <h2>Track an admitted route</h2>
        <p>
          Watchlists are private to your account and do not create an investment recommendation.
        </p>
        <div className="inline-actions">
          <select className="select" name="routeSlug" required>
            {records.map((record) => (
              <option key={record.id} value={record.slug}>
                {record.productName} · {record.routeName}
              </option>
            ))}
          </select>
          <button className="button button-primary" disabled={pending} type="submit">
            <Plus aria-hidden size={15} /> Add
          </button>
        </div>
        {message ? (
          <p aria-live="polite" className="legal-strip">
            {message}
          </p>
        ) : null}
      </form>
      <section className="panel">
        <span className="eyebrow">Saved routes</span>
        <h2>Your private list</h2>
        {items.length === 0 ? (
          <p className="muted">No saved routes yet.</p>
        ) : (
          <ul className="plain-list">
            {items.map((item) => (
              <li className="list-row" key={item.id}>
                <span>
                  <strong>{item.productName}</strong>
                  <br />
                  <span className="faint">{item.routeName}</span>
                </span>
                <button
                  aria-label={`Remove ${item.productName} from watchlist`}
                  className="icon-button"
                  disabled={pending}
                  onClick={() => void remove(item.routeSlug)}
                  type="button"
                >
                  <Trash2 aria-hidden size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
