"use client";

import { Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { browserFetch } from "@/lib/browser-fetch";

const settingsResponseSchema = z.object({
  data: z
    .object({
      chains: z.array(z.string()),
      jurisdiction: z.string(),
      riskProfile: z.string(),
      timezone: z.string()
    })
    .nullable()
});

const initialSettings = {
  chains: "",
  jurisdiction: "",
  riskProfile: "BALANCED",
  timezone: "Asia/Calcutta"
};

export function SettingsForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [settings, setSettings] = useState(initialSettings);

  useEffect(() => {
    void fetch("/api/v1/settings", { cache: "no-store" })
      .then(async (response) =>
        response.ok ? settingsResponseSchema.safeParse(await response.json()) : null
      )
      .then((parsed) => {
        if (parsed?.success && parsed.data.data) {
          setSettings({
            chains: parsed.data.data.chains.join(", "),
            jurisdiction: parsed.data.data.jurisdiction,
            riskProfile: parsed.data.data.riskProfile,
            timezone: parsed.data.data.timezone
          });
        }
      });
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const response = await browserFetch("/api/v1/settings", {
      body: JSON.stringify({
        chains: settings.chains
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        jurisdiction: settings.jurisdiction,
        riskProfile: settings.riskProfile,
        timezone: settings.timezone
      }),
      headers: { "content-type": "application/json" },
      method: "PUT"
    });
    setMessage(
      response.ok
        ? "Preferences saved."
        : "Preferences could not be saved. Check your session and configuration."
    );
  };

  return (
    <form className="panel" onSubmit={submit}>
      <span className="eyebrow">Account preferences</span>
      <h2>Personalize filters and alerts</h2>
      <div className="form-grid">
        <label className="field">
          <span>Jurisdiction (ISO country code)</span>
          <input
            className="input"
            maxLength={2}
            onChange={(event) =>
              setSettings((current) => ({ ...current, jurisdiction: event.currentTarget.value }))
            }
            required
            value={settings.jurisdiction}
          />
        </label>
        <label className="field">
          <span>Risk profile</span>
          <select
            className="select"
            onChange={(event) =>
              setSettings((current) => ({ ...current, riskProfile: event.currentTarget.value }))
            }
            value={settings.riskProfile}
          >
            <option value="CAPITAL_PRESERVATION">Capital preservation</option>
            <option value="CONSERVATIVE">Conservative</option>
            <option value="BALANCED">Balanced</option>
            <option value="YIELD_SEEKING">Yield seeking</option>
            <option value="CUSTOM">Custom</option>
          </select>
        </label>
        <label className="field">
          <span>Preferred chains (comma separated)</span>
          <input
            className="input"
            onChange={(event) =>
              setSettings((current) => ({ ...current, chains: event.currentTarget.value }))
            }
            placeholder="Ethereum, Base"
            value={settings.chains}
          />
        </label>
        <label className="field">
          <span>IANA timezone</span>
          <input
            className="input"
            onChange={(event) =>
              setSettings((current) => ({ ...current, timezone: event.currentTarget.value }))
            }
            required
            value={settings.timezone}
          />
        </label>
      </div>
      <button className="button button-primary" style={{ marginTop: 18 }} type="submit">
        <Save aria-hidden size={15} /> Save settings
      </button>
      {message ? (
        <p aria-live="polite" className="legal-strip">
          {message}
        </p>
      ) : null}
    </form>
  );
}
