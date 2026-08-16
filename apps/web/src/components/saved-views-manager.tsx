"use client";

import { Pencil, RefreshCw, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { browserFetch } from "@/lib/browser-fetch";
import { formatTimestamp } from "@/lib/format";
import { savedViewStateSchema, type SavedViewState } from "@/lib/saved-research-contract";

const savedViewsResponseSchema = z.object({
  data: z.array(
    savedViewStateSchema.extend({
      createdAt: z.string(),
      id: z.uuid(),
      name: z.string(),
      updatedAt: z.string()
    })
  )
});

type SavedView = z.infer<typeof savedViewsResponseSchema>["data"][number];

export function SavedViewsManager({
  current,
  enabled,
  onApply
}: {
  current: SavedViewState;
  enabled: boolean;
  onApply: (view: SavedViewState) => void;
}) {
  const [items, setItems] = useState<SavedView[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/v1/saved-views", { cache: "no-store" });
    if (!response.ok) return;
    const parsed = savedViewsResponseSchema.safeParse(await response.json());
    if (parsed.success) setItems(parsed.data.data);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void fetch("/api/v1/saved-views", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? savedViewsResponseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success) setItems(parsed.data.data);
      });
  }, [enabled]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setPending(true);
    const form = new FormData(formElement);
    try {
      const response = await browserFetch("/api/v1/saved-views", {
        body: JSON.stringify({ name: form.get("name"), ...current }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      setMessage(
        response.ok
          ? "Screener view saved to your private workspace."
          : "The view could not be saved. Use a unique name and check your session."
      );
      if (response.ok) {
        formElement.reset();
        await load();
      }
    } catch {
      setMessage("The view could not be saved because browser security validation failed.");
    } finally {
      setPending(false);
    }
  };

  const rename = async (item: SavedView) => {
    const name = window.prompt("Saved view name", item.name)?.trim();
    if (!name) return;
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/saved-views", {
        body: JSON.stringify({
          filters: item.filters,
          id: item.id,
          name,
          sort: item.sort,
          visibleColumns: item.visibleColumns
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      setMessage(response.ok ? "Saved view renamed." : "The saved view could not be renamed.");
      if (response.ok) await load();
    } catch {
      setMessage("The saved view could not be renamed because browser security validation failed.");
    } finally {
      setPending(false);
    }
  };

  const archive = async (id: string) => {
    setPending(true);
    try {
      const response = await browserFetch(`/api/v1/saved-views?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      setMessage(response.ok ? "Saved view archived." : "The saved view could not be archived.");
      if (response.ok) await load();
    } catch {
      setMessage(
        "The saved view could not be archived because browser security validation failed."
      );
    } finally {
      setPending(false);
    }
  };

  const replaceView = async (item: SavedView) => {
    if (!window.confirm(`Replace the controls in ${item.name} with the current screener view?`))
      return;
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/saved-views", {
        body: JSON.stringify({ id: item.id, name: item.name, ...current }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      setMessage(response.ok ? "Saved view replaced." : "The saved view could not be replaced.");
      if (response.ok) await load();
    } catch {
      setMessage(
        "The saved view could not be replaced because browser security validation failed."
      );
    } finally {
      setPending(false);
    }
  };

  if (!enabled)
    return (
      <section className="panel">
        <span className="eyebrow">Private screener views</span>
        <h2>Keep filters, sort, and columns together</h2>
        <p>The URL remains public and shareable. A saved view stays private to your account.</p>
        <Link className="button button-secondary" href="/auth/sign-in">
          Sign in to save this view
        </Link>
      </section>
    );

  return (
    <div className="grid grid-2">
      <form className="panel" onSubmit={save}>
        <span className="eyebrow">Private screener view</span>
        <h2>Save the current controls</h2>
        <label className="field">
          <span>Name</span>
          <input className="input" maxLength={120} name="name" required />
        </label>
        <button className="button button-primary" disabled={pending} type="submit">
          <Save aria-hidden size={15} /> Save view
        </button>
        {message ? (
          <p aria-live="polite" className="legal-strip">
            {message}
          </p>
        ) : null}
      </form>
      <section className="panel">
        <span className="eyebrow">Saved views</span>
        <h2>Your private presets</h2>
        {items.length === 0 ? (
          <p className="muted">No saved screener views yet.</p>
        ) : (
          <ul className="plain-list">
            {items.map((item) => (
              <li className="list-row" key={item.id}>
                <span className="stack">
                  <strong>{item.name}</strong>
                  <span className="faint">
                    {item.visibleColumns.length} columns / updated {formatTimestamp(item.updatedAt)}
                  </span>
                </span>
                <span className="inline-actions">
                  <button
                    aria-label={`Apply ${item.name}`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => onApply(item)}
                    type="button"
                  >
                    <SlidersHorizontal aria-hidden size={15} />
                  </button>
                  <button
                    aria-label={`Rename ${item.name}`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => void rename(item)}
                    type="button"
                  >
                    <Pencil aria-hidden size={15} />
                  </button>
                  <button
                    aria-label={`Replace ${item.name} with the current screener view`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => void replaceView(item)}
                    type="button"
                  >
                    <RefreshCw aria-hidden size={15} />
                  </button>
                  <button
                    aria-label={`Archive ${item.name}`}
                    className="icon-button"
                    disabled={pending}
                    onClick={() => void archive(item.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden size={15} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
