"use client";

import { BellRing, Power, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";

import type { CatalogRecord } from "@/lib/catalog";
import {
  ALERT_TRIGGER_DEFINITIONS,
  alertTriggerDefinition,
  type AlertTrigger
} from "@/lib/alert-definitions";
import { browserFetch } from "@/lib/browser-fetch";

const destinationSchema = z.object({
  channel: z.enum(["IN_APP", "EMAIL", "TELEGRAM", "CONSOLE"]),
  createdAt: z.coerce.date().optional(),
  disabledAt: z.coerce.date().nullable(),
  id: z.string().uuid(),
  maskedLabel: z.string(),
  verifiedAt: z.coerce.date().nullable()
});
const destinationsResponseSchema = z.object({ data: z.array(destinationSchema) });
type DestinationItem = z.infer<typeof destinationSchema>;

const ruleSchema = z.object({
  channel: z.enum(["IN_APP", "EMAIL", "TELEGRAM", "CONSOLE"]),
  condition: z.string(),
  cooldownSeconds: z.number(),
  createdAt: z.coerce.date(),
  destinationId: z.string().uuid(),
  destinationLabel: z.string(),
  destinationVerifiedAt: z.coerce.date().nullable(),
  enabled: z.boolean(),
  id: z.string().uuid(),
  lastEvaluation: z
    .object({
      evaluatedAt: z.string(),
      reason: z.string().nullable(),
      status: z.enum(["CURRENT", "COOLDOWN", "TRIGGERED", "UNAVAILABLE"])
    })
    .nullable(),
  routeName: z.string(),
  routeSlug: z.string(),
  threshold: z.string().nullable(),
  timezone: z.string()
});
const rulesResponseSchema = z.object({ data: z.array(ruleSchema) });
const createdResponseSchema = z.object({ data: z.object({ id: z.string().uuid() }) });
const testResponseSchema = z.object({ status: z.enum(["DELIVERED", "QUEUED"]) });
type AlertRuleItem = z.infer<typeof ruleSchema>;

export function AlertRuleForm({ records }: { records: CatalogRecord[] }) {
  const [channel, setChannel] = useState<"IN_APP" | "EMAIL" | "TELEGRAM">("IN_APP");
  const [destinations, setDestinations] = useState<DestinationItem[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [rules, setRules] = useState<AlertRuleItem[]>([]);
  const [trigger, setTrigger] = useState<AlertTrigger>("APY_ABOVE");
  const triggerDefinition = alertTriggerDefinition(trigger);

  const load = useCallback(async () => {
    const [rulesResponse, destinationsResponse] = await Promise.all([
      fetch("/api/v1/alerts", { cache: "no-store" }),
      fetch("/api/v1/notification-destinations", { cache: "no-store" })
    ]);
    if (rulesResponse.ok) {
      const parsed = rulesResponseSchema.safeParse(await rulesResponse.json());
      if (parsed.success) setRules(parsed.data.data);
    }
    if (destinationsResponse.ok) {
      const parsed = destinationsResponseSchema.safeParse(await destinationsResponse.json());
      if (parsed.success) setDestinations(parsed.data.data);
    }
  }, []);

  useEffect(() => {
    void Promise.all([
      fetch("/api/v1/alerts", { cache: "no-store" }),
      fetch("/api/v1/notification-destinations", { cache: "no-store" })
    ]).then(async ([rulesResponse, destinationsResponse]) => {
      if (rulesResponse.ok) {
        const parsed = rulesResponseSchema.safeParse(await rulesResponse.json());
        if (parsed.success) setRules(parsed.data.data);
      }
      if (destinationsResponse.ok) {
        const parsed = destinationsResponseSchema.safeParse(await destinationsResponse.json());
        if (parsed.success) setDestinations(parsed.data.data);
      }
    });
  }, []);

  const activeExternalDestinations = useMemo(
    () =>
      destinations.filter(
        (destination) => destination.channel === channel && destination.disabledAt === null
      ),
    [channel, destinations]
  );

  const createDestination = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await browserFetch("/api/v1/notification-destinations", {
        body: JSON.stringify({
          channel: form.get("destinationChannel"),
          destination: form.get("destination")
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      setMessage(
        response.ok
          ? "Encrypted destination saved. Send a test before relying on external alerts."
          : "The destination could not be saved. Check its format and server encryption configuration."
      );
      if (response.ok) {
        event.currentTarget.reset();
        await load();
      }
    } catch {
      setMessage(
        "The destination could not be saved because the browser security token is unavailable."
      );
    } finally {
      setPending(false);
    }
  };

  const disableDestination = async (id: string) => {
    setPending(true);
    try {
      const response = await browserFetch(
        `/api/v1/notification-destinations?id=${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      setMessage(
        response.ok
          ? "Destination disabled and its pending deliveries cancelled."
          : "Destination could not be disabled."
      );
      if (response.ok) await load();
    } catch {
      setMessage(
        "Destination could not be disabled because the browser security token is unavailable."
      );
    } finally {
      setPending(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await browserFetch("/api/v1/alerts", {
        body: JSON.stringify({
          channel,
          cooldownMinutes: form.get("cooldownMinutes"),
          destinationId: channel === "IN_APP" ? null : form.get("destinationId"),
          lookbackHours: form.get("lookbackHours") ?? 24,
          routeSlug: form.get("routeSlug"),
          threshold: "event" in triggerDefinition ? null : form.get("threshold"),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          trigger
        }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const parsed = response.ok ? createdResponseSchema.safeParse(await response.json()) : null;
      setMessage(
        parsed?.success
          ? "Alert rule created. Missing or stale source evidence will be reported as unavailable, never zero."
          : "The alert could not be created. Check your session, destination, and threshold."
      );
      if (parsed?.success) await load();
    } catch {
      setMessage(
        "The alert could not be created because the browser security token is unavailable."
      );
    } finally {
      setPending(false);
    }
  };

  const testNotification = async (ruleId: string) => {
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/alerts/test", {
        body: JSON.stringify({ ruleId }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const parsed = response.ok ? testResponseSchema.safeParse(await response.json()) : null;
      setMessage(
        parsed?.success
          ? parsed.data.status === "DELIVERED"
            ? "Test in-app notification delivered."
            : "External test queued. The worker will verify the destination after provider delivery."
          : "The test could not be queued. Check the destination and provider configuration."
      );
    } catch {
      setMessage("The test could not be queued because the browser security token is unavailable.");
    } finally {
      setPending(false);
    }
  };

  const toggle = async (rule: AlertRuleItem) => {
    setPending(true);
    try {
      const response = await browserFetch("/api/v1/alerts", {
        body: JSON.stringify({ enabled: !rule.enabled, id: rule.id }),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      setMessage(
        response.ok
          ? `Alert ${rule.enabled ? "paused" : "enabled"}.`
          : "Alert state could not be changed."
      );
      if (response.ok) await load();
    } catch {
      setMessage(
        "Alert state could not be changed because the browser security token is unavailable."
      );
    } finally {
      setPending(false);
    }
  };

  const remove = async (id: string) => {
    setPending(true);
    try {
      const response = await browserFetch(`/api/v1/alerts?id=${encodeURIComponent(id)}`, {
        method: "DELETE"
      });
      setMessage(response.ok ? "Alert archived and unsubscribed." : "Alert could not be archived.");
      if (response.ok) await load();
    } catch {
      setMessage("Alert could not be archived because the browser security token is unavailable.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Secure destinations</span>
            <h2>Email and Telegram</h2>
            <p>
              External destinations are encrypted at rest. They remain unverified until a provider
              accepts a test delivery. In-app alerts require no external destination.
            </p>
          </div>
        </div>
        <form className="form-grid" onSubmit={createDestination}>
          <label className="field">
            <span>Channel</span>
            <select className="select" name="destinationChannel">
              <option value="EMAIL">Email</option>
              <option value="TELEGRAM">Telegram chat</option>
            </select>
          </label>
          <label className="field">
            <span>Email address or numeric Telegram chat ID</span>
            <input className="input" maxLength={512} name="destination" required type="text" />
          </label>
          <button className="button" disabled={pending} type="submit">
            Save encrypted destination
          </button>
        </form>
        {destinations.filter((destination) => destination.channel !== "IN_APP").length > 0 ? (
          <ul className="plain-list">
            {destinations
              .filter((destination) => destination.channel !== "IN_APP")
              .map((destination) => (
                <li className="list-row" key={destination.id}>
                  <span>
                    <strong>{destination.maskedLabel}</strong>
                    <br />
                    <span className="faint">
                      {destination.channel} · {destination.disabledAt ? "Disabled" : "Active"} ·{" "}
                      {destination.verifiedAt ? "Test delivered" : "Awaiting successful test"}
                    </span>
                  </span>
                  {destination.disabledAt === null ? (
                    <button
                      className="button button-ghost"
                      disabled={pending}
                      onClick={() => void disableDestination(destination.id)}
                      type="button"
                    >
                      Disable
                    </button>
                  ) : null}
                </li>
              ))}
          </ul>
        ) : null}
      </section>

      <div className="grid grid-2">
        <form className="panel" onSubmit={submit}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">New rule</span>
              <h2>Monitor a material change</h2>
              <p>
                Every condition evaluates only when its required sourced snapshot, history, or
                versioned event exists. Unsupported evidence stays explicitly unavailable.
              </p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field">
              <span>Product route</span>
              <select className="select" name="routeSlug" required>
                {records.map((record) => (
                  <option key={record.id} value={record.slug}>
                    {record.productName} · {record.routeName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Trigger</span>
              <select
                className="select"
                name="trigger"
                onChange={(event) => setTrigger(event.target.value as AlertTrigger)}
                value={trigger}
              >
                {ALERT_TRIGGER_DEFINITIONS.map((definition) => (
                  <option key={definition.trigger} value={definition.trigger}>
                    {definition.label}
                  </option>
                ))}
              </select>
            </label>
            {"event" in triggerDefinition ? null : (
              <label className="field">
                <span>Threshold ({triggerDefinition.unit.toLowerCase().replaceAll("_", " ")})</span>
                <input
                  className="input"
                  min="0"
                  name="threshold"
                  required
                  step="any"
                  type="number"
                />
              </label>
            )}
            {"lookback" in triggerDefinition ? (
              <label className="field">
                <span>Lookback (hours)</span>
                <input
                  className="input"
                  defaultValue="24"
                  max="8760"
                  min="1"
                  name="lookbackHours"
                  required
                  type="number"
                />
              </label>
            ) : null}
            <label className="field">
              <span>Channel</span>
              <select
                className="select"
                name="channel"
                onChange={(event) =>
                  setChannel(event.target.value as "IN_APP" | "EMAIL" | "TELEGRAM")
                }
                value={channel}
              >
                <option value="IN_APP">In-app</option>
                <option value="EMAIL">Email</option>
                <option value="TELEGRAM">Telegram</option>
              </select>
            </label>
            {channel === "IN_APP" ? null : (
              <label className="field">
                <span>Destination</span>
                <select className="select" name="destinationId" required>
                  <option value="">Select an active encrypted destination</option>
                  {activeExternalDestinations.map((destination) => (
                    <option key={destination.id} value={destination.id}>
                      {destination.maskedLabel} ·{" "}
                      {destination.verifiedAt ? "tested" : "test required"}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">
              <span>Cooldown (minutes)</span>
              <input
                className="input"
                defaultValue="360"
                min="5"
                name="cooldownMinutes"
                required
                type="number"
              />
            </label>
          </div>
          <button
            className="button button-primary"
            disabled={pending || (channel !== "IN_APP" && activeExternalDestinations.length === 0)}
            style={{ marginTop: 18 }}
            type="submit"
          >
            <BellRing aria-hidden size={15} /> {pending ? "Working…" : "Create alert"}
          </button>
          {message ? (
            <p aria-live="polite" className="legal-strip">
              {message}
            </p>
          ) : null}
        </form>
        <section className="panel">
          <span className="eyebrow">Active configuration</span>
          <h2>Your alert rules</h2>
          {rules.length === 0 ? (
            <p className="muted">No alert rules yet.</p>
          ) : (
            <ul className="plain-list">
              {rules.map((rule) => (
                <li className="list-row" key={rule.id}>
                  <span>
                    <strong>{rule.routeName}</strong>
                    <br />
                    <span className="faint">
                      {rule.condition.replaceAll("_", " ")} {rule.threshold ?? "event"} ·{" "}
                      {rule.channel} {rule.destinationLabel} · {rule.enabled ? "Enabled" : "Paused"}
                      {rule.lastEvaluation === null
                        ? " · Awaiting first evaluation"
                        : rule.lastEvaluation.status === "UNAVAILABLE"
                          ? ` · Evidence unavailable (${rule.lastEvaluation.reason ?? "unspecified"})`
                          : ` · Last evaluation ${rule.lastEvaluation.status.toLowerCase()}`}
                    </span>
                  </span>
                  <span className="inline-actions">
                    <button
                      aria-label="Send test notification"
                      className="icon-button"
                      disabled={pending}
                      onClick={() => void testNotification(rule.id)}
                      type="button"
                    >
                      <Send aria-hidden size={15} />
                    </button>
                    <button
                      aria-label={rule.enabled ? "Pause alert" : "Enable alert"}
                      className="icon-button"
                      disabled={pending}
                      onClick={() => void toggle(rule)}
                      type="button"
                    >
                      <Power aria-hidden size={15} />
                    </button>
                    <button
                      aria-label="Archive alert"
                      className="icon-button"
                      disabled={pending}
                      onClick={() => void remove(rule.id)}
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
    </div>
  );
}
