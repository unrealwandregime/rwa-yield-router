"use client";

import { ExternalLink, Pencil, RefreshCw, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { z } from "zod";

import { browserFetch } from "@/lib/browser-fetch";
import { formatTimestamp } from "@/lib/format";

const savedComparisonsResponseSchema = z.object({
  data: z.array(
    z.object({
      createdAt: z.string(),
      id: z.uuid(),
      items: z.array(
        z.object({
          position: z.number().int().min(1).max(5),
          productName: z.string(),
          routeName: z.string(),
          routeSlug: z.string()
        })
      ),
      name: z.string(),
      updatedAt: z.string()
    })
  )
});

type SavedComparison = z.infer<typeof savedComparisonsResponseSchema>["data"][number];

export function SavedComparisonsManager({
  currentRouteSlugs,
  enabled
}: {
  currentRouteSlugs: readonly string[];
  enabled: boolean;
}) {
  const [items, setItems] = useState<SavedComparison[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    if (!enabled) return;
    const response = await fetch("/api/v1/saved-comparisons", { cache: "no-store" });
    if (!response.ok) return;
    const parsed = savedComparisonsResponseSchema.safeParse(await response.json());
    if (parsed.success) setItems(parsed.data.data);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void fetch("/api/v1/saved-comparisons", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? savedComparisonsResponseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success) setItems(parsed.data.data);
      });
  }, [enabled]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (currentRouteSlugs.length < 2 || currentRouteSlugs.length > 5) return;
    const formElement = event.currentTarget;
    setPending(true);
    const form = new FormData(formElement);
    try {
      const response = await browserFetch("/api/v1/saved-comparisons", {
        body: JSON.stringify({ name: form.get("name"), routeSlugs: currentRouteSlugs }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      setMessage(
        response.ok
          ? "Comparison saved to your private workspace."
          : "The comparison could not be saved. Use a unique name and check your session."
      );
      if (response.ok) {
        formElement.reset();
        await load();
      }
    } catch {
      setMessage("The comparison could not be saved because browser security validation failed.");
    } finally {
      setPending(false);
    }
  };

  const rename = async (item: SavedComparison) => {
    const name = window.prompt("Comparison name", item.name)?.trim();
    if (!name) return;
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/saved-comparisons", {
        body: JSON.stringify({
          id: item.id,
          name
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      setMessage(response.ok ? "Comparison renamed." : "The comparison could not be renamed.");
      if (response.ok) await load();
    } catch {
      setMessage("The comparison could not be renamed because browser security validation failed.");
    } finally {
      setPending(false);
    }
  };

  const archive = async (id: string) => {
    setPending(true);
    try {
      const response = await browserFetch(
        `/api/v1/saved-comparisons?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      setMessage(response.ok ? "Comparison archived." : "The comparison could not be archived.");
      if (response.ok) await load();
    } catch {
      setMessage(
        "The comparison could not be archived because browser security validation failed."
      );
    } finally {
      setPending(false);
    }
  };

  const replaceRoutes = async (item: SavedComparison) => {
    if (currentRouteSlugs.length < 2 || currentRouteSlugs.length > 5) return;
    if (!window.confirm(`Replace the routes in ${item.name} with the current comparison?`)) return;
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/saved-comparisons", {
        body: JSON.stringify({ id: item.id, routeSlugs: currentRouteSlugs }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      setMessage(
        response.ok ? "Saved comparison routes replaced." : "The routes could not be replaced."
      );
      if (response.ok) await load();
    } catch {
      setMessage("The routes could not be replaced because browser security validation failed.");
    } finally {
      setPending(false);
    }
  };

  if (!enabled)
    return (
      <section className="panel">
        <span className="eyebrow">Private comparisons</span>
        <h2>Save this public comparison to your account</h2>
        <p>The route-based URL remains public and shareable; saved names and lists stay private.</p>
        <Link className="button button-secondary" href="/auth/sign-in">
          Sign in to save
        </Link>
      </section>
    );

  return (
    <div className="grid grid-2">
      <form className="panel" onSubmit={save}>
        <span className="eyebrow">Private comparison</span>
        <h2>Save the current route set</h2>
        {currentRouteSlugs.length >= 2 && currentRouteSlugs.length <= 5 ? (
          <>
            <label className="field">
              <span>Name</span>
              <input className="input" maxLength={120} name="name" required />
            </label>
            <button className="button button-primary" disabled={pending} type="submit">
              <Save aria-hidden size={15} /> Save comparison
            </button>
          </>
        ) : (
          <p className="muted">Choose between two and five unique routes before saving.</p>
        )}
        {message ? (
          <p aria-live="polite" className="legal-strip">
            {message}
          </p>
        ) : null}
      </form>
      <section className="panel">
        <span className="eyebrow">Saved comparisons</span>
        <h2>Your private list</h2>
        {items.length === 0 ? (
          <p className="muted">No saved comparisons yet.</p>
        ) : (
          <ul className="plain-list">
            {items.map((item) => {
              const href = `/compare?routes=${item.items.map((route) => route.routeSlug).join(",")}`;
              return (
                <li className="list-row" key={item.id}>
                  <span className="stack">
                    <strong>{item.name}</strong>
                    <span className="faint">
                      {item.items.length} routes / updated {formatTimestamp(item.updatedAt)}
                    </span>
                  </span>
                  <span className="inline-actions">
                    <Link aria-label={`Open ${item.name}`} className="icon-button" href={href}>
                      <ExternalLink aria-hidden size={15} />
                    </Link>
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
                      aria-label={`Replace routes in ${item.name} with the current comparison`}
                      className="icon-button"
                      disabled={
                        pending || currentRouteSlugs.length < 2 || currentRouteSlugs.length > 5
                      }
                      onClick={() => void replaceRoutes(item)}
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
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
