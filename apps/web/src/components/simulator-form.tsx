"use client";

import { AlertTriangle, Printer, Route, Save } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { LegalStrip } from "@/components/legal-strip";
import { browserFetch } from "@/lib/browser-fetch";
import { formatPercent, formatRisk } from "@/lib/format";

const simulationResultSchema = z.discriminatedUnion("status", [
  z.object({
    allocations: z.array(
      z.object({
        percentage: z.string(),
        productName: z.string(),
        rationale: z.string(),
        riskAdjustedApy: z.string(),
        riskScore: z.string(),
        routeName: z.string(),
        routeSlug: z.string()
      })
    ),
    assumptions: z.array(z.string()),
    dataTimestamp: z.string(),
    grossBlendedApy: z.string(),
    immediateLiquidity: z.string(),
    methodologyVersion: z.string(),
    netBlendedApy: z.string(),
    riskAdjustedApy: z.string(),
    savedSimulationId: z.string().uuid().nullable(),
    sevenDayLiquidity: z.string(),
    status: z.literal("FEASIBLE"),
    twentyFourHourLiquidity: z.string(),
    weightedRiskScore: z.string()
  }),
  z.object({
    dataTimestamp: z.string(),
    diagnostics: z.array(
      z.object({ code: z.string(), message: z.string(), suggestedChange: z.string().optional() })
    ),
    excludedCount: z.number(),
    methodologyVersion: z.string(),
    savedSimulationId: z.string().uuid().nullable(),
    status: z.literal("INFEASIBLE")
  })
]);

type SimulationResult = z.infer<typeof simulationResultSchema>;

export function SimulatorForm() {
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPayload, setLastPayload] = useState<Record<string, unknown> | null>(null);
  const [pending, setPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      capital: form.get("capital"),
      advancedResearchMode: form.get("advancedResearchMode") === "on",
      currentAsset: form.get("currentAsset"),
      currentChain: form.get("currentChain"),
      holdingPeriodDays: form.get("holdingPeriodDays"),
      jurisdiction: form.get("jurisdiction"),
      investorClassification: form.get("investorClassification"),
      kycAcceptable: form.get("kycAcceptable") === "on",
      preferredChains: String(form.get("preferredChains") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      profile: form.get("profile"),
      maximumProductAllocation: form.get("maximumProductAllocation"),
      maximumIssuerExposure: form.get("maximumIssuerExposure"),
      maximumProtocolExposure: form.get("maximumProtocolExposure"),
      maximumChainExposure: form.get("maximumChainExposure"),
      maximumDefiExposure: form.get("maximumDefiExposure"),
      maximumRwaExposure: form.get("maximumRwaExposure"),
      maximumGoldExposure: form.get("maximumGoldExposure"),
      minimumImmediateLiquidity: form.get("minimumImmediateLiquidity"),
      minimumTwentyFourHourLiquidity: form.get("minimumTwentyFourHourLiquidity"),
      minimumSevenDayLiquidity: form.get("minimumSevenDayLiquidity"),
      incentivesAcceptable: form.get("incentivesAcceptable") === "on",
      minimumConfidence: form.get("minimumConfidence")
    };
    setLastPayload(payload);

    try {
      const response = await browserFetch("/api/v1/simulations", {
        body: JSON.stringify(payload),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const envelope = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
        throw new Error(
          envelope.success ? envelope.data.error.message : "Simulation request failed safely."
        );
      }
      const parsed = simulationResultSchema.safeParse(body);
      if (!parsed.success)
        throw new Error("The simulation response did not match the published contract.");
      setResult(parsed.data);
    } catch (caught) {
      setResult(null);
      setError(caught instanceof Error ? caught.message : "Simulation failed safely.");
    } finally {
      setPending(false);
    }
  };

  const save = async () => {
    if (!lastPayload) return;
    setPending(true);
    setSaveMessage(null);
    const response = await browserFetch("/api/v1/simulations", {
      body: JSON.stringify({ ...lastPayload, saveRequested: true }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });
    const body: unknown = await response.json();
    const parsed = simulationResultSchema.safeParse(body);
    setSaveMessage(
      response.ok && parsed.success && parsed.data.savedSimulationId
        ? "Immutable simulation snapshot saved."
        : "The simulation could not be saved. Sign in and verify database reference data."
    );
    setPending(false);
  };

  return (
    <>
      <form className="panel simulator-form" onSubmit={submit}>
        <div className="section-heading">
          <div>
            <span className="eyebrow">Simulation inputs</span>
            <h2>Capital, access, risk, and concentration</h2>
            <p>Profiles expand into visible constraints. Nothing is relaxed silently.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Capital amount (USD)</span>
            <input
              className="input"
              defaultValue="100000"
              min="1"
              name="capital"
              required
              step="0.01"
              type="number"
            />
          </label>
          <label className="field">
            <span>Holding period (days)</span>
            <input
              className="input"
              defaultValue="365"
              min="1"
              name="holdingPeriodDays"
              required
              type="number"
            />
          </label>
          <label className="field">
            <span>Current asset</span>
            <input className="input" defaultValue="USDC" name="currentAsset" required />
          </label>
          <label className="field">
            <span>Current chain</span>
            <input className="input" defaultValue="Ethereum" name="currentChain" required />
          </label>
          <label className="field">
            <span>Jurisdiction (ISO country code)</span>
            <input className="input" defaultValue="IN" maxLength={2} name="jurisdiction" required />
          </label>
          <label className="field">
            <span>Investor classification</span>
            <select className="select" defaultValue="RETAIL" name="investorClassification">
              <option value="RETAIL">Retail</option>
              <option value="ACCREDITED">Accredited</option>
              <option value="QUALIFIED">Qualified purchaser</option>
              <option value="PROFESSIONAL">Professional</option>
              <option value="INSTITUTIONAL">Institutional</option>
            </select>
          </label>
          <label className="field">
            <span>Risk profile</span>
            <select className="select" defaultValue="BALANCED" name="profile">
              <option value="CAPITAL_PRESERVATION">Capital preservation</option>
              <option value="CONSERVATIVE">Conservative</option>
              <option value="BALANCED">Balanced</option>
              <option value="YIELD_SEEKING">Yield seeking</option>
              <option value="CUSTOM">Custom</option>
            </select>
          </label>
          <label className="field">
            <span>Preferred chains (comma separated)</span>
            <input className="input" defaultValue="Ethereum, Base" name="preferredChains" />
          </label>
        </div>
        <hr className="divider" />
        <div className="form-grid">
          <label className="field">
            <span>Maximum per product (%)</span>
            <input
              className="input"
              defaultValue="25"
              max="100"
              min="1"
              name="maximumProductAllocation"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum per issuer (%)</span>
            <input
              className="input"
              defaultValue="35"
              max="100"
              min="1"
              name="maximumIssuerExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum per protocol (%)</span>
            <input
              className="input"
              defaultValue="35"
              max="100"
              min="1"
              name="maximumProtocolExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum per chain (%)</span>
            <input
              className="input"
              defaultValue="60"
              max="100"
              min="1"
              name="maximumChainExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum DeFi exposure (%)</span>
            <input
              className="input"
              defaultValue="50"
              max="100"
              min="0"
              name="maximumDefiExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum RWA exposure (%)</span>
            <input
              className="input"
              defaultValue="60"
              max="100"
              min="0"
              name="maximumRwaExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Maximum gold exposure (%)</span>
            <input
              className="input"
              defaultValue="15"
              max="100"
              min="0"
              name="maximumGoldExposure"
              type="number"
            />
          </label>
          <label className="field">
            <span>Minimum immediate liquidity (%)</span>
            <input
              className="input"
              defaultValue="20"
              max="100"
              min="0"
              name="minimumImmediateLiquidity"
              type="number"
            />
          </label>
          <label className="field">
            <span>Minimum liquid within 24h (%)</span>
            <input
              className="input"
              defaultValue="50"
              max="100"
              min="0"
              name="minimumTwentyFourHourLiquidity"
              type="number"
            />
          </label>
          <label className="field">
            <span>Minimum liquid within 7d (%)</span>
            <input
              className="input"
              defaultValue="90"
              max="100"
              min="0"
              name="minimumSevenDayLiquidity"
              type="number"
            />
          </label>
          <label className="field">
            <span>Minimum confidence</span>
            <select className="select" defaultValue="MANUALLY_VERIFIED" name="minimumConfidence">
              <option value="VERIFIED_OFFICIAL">Verified official</option>
              <option value="ONCHAIN_DERIVED">On-chain derived</option>
              <option value="DIRECT_API">Direct API</option>
              <option value="MANUALLY_VERIFIED">Manually verified</option>
              <option value="THIRD_PARTY">Third party</option>
            </select>
          </label>
        </div>
        <div className="checkbox-grid">
          <label>
            <input defaultChecked name="kycAcceptable" type="checkbox" /> KYC routes are acceptable
          </label>
          <label>
            <input name="incentivesAcceptable" type="checkbox" /> Temporary incentive yield is
            acceptable
          </label>
          <label>
            <input name="advancedResearchMode" type="checkbox" /> Advanced research: allow
            conditional eligibility and explicit zero-cost assumptions
          </label>
        </div>
        <LegalStrip compact />
        <button className="button button-primary" disabled={pending} type="submit">
          <Route aria-hidden size={16} />{" "}
          {pending ? "Solving constraints…" : "Run analytical simulation"}
        </button>
      </form>

      {error ? (
        <div className="legal-strip" role="alert">
          <AlertTriangle aria-hidden size={17} />
          <p>{error}</p>
        </div>
      ) : null}

      {result?.status === "INFEASIBLE" ? (
        <section className="panel simulation-result" id="simulation-result">
          <span className="eyebrow">No feasible allocation</span>
          <h2>The constraints cannot be satisfied by current eligible data</h2>
          <p className="muted">
            No allocation was forced. {result.excludedCount} candidates were excluded before or
            during optimization.
          </p>
          <button
            className="button button-secondary no-print"
            disabled={pending}
            onClick={() => void save()}
            type="button"
          >
            <Save aria-hidden size={15} /> Save diagnostics
          </button>
          <div className="grid grid-2">
            {result.diagnostics.map((diagnostic) => (
              <article className="card" key={`${diagnostic.code}:${diagnostic.message}`}>
                <span className="label">{diagnostic.code.replaceAll("_", " ")}</span>
                <h3 style={{ marginTop: 10 }}>{diagnostic.message}</h3>
                {diagnostic.suggestedChange ? <p>{diagnostic.suggestedChange}</p> : null}
              </article>
            ))}
          </div>
          <p className="faint" style={{ fontSize: 11 }}>
            Methodology {result.methodologyVersion} · data cutoff {result.dataTimestamp}
          </p>
        </section>
      ) : null}

      {result?.status === "FEASIBLE" ? (
        <section className="panel simulation-result" id="simulation-result">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Analytical allocation</span>
              <h2>Constraint-validated route mix</h2>
            </div>
            <div className="inline-actions no-print">
              <button
                className="button button-secondary"
                onClick={() => window.print()}
                type="button"
              >
                <Printer aria-hidden size={15} /> Print report
              </button>
              <button
                className="button button-secondary"
                disabled={pending}
                onClick={() => void save()}
                type="button"
              >
                <Save aria-hidden size={15} /> Save
              </button>
            </div>
          </div>
          <LegalStrip compact />
          {result.assumptions.length > 0 ? (
            <div className="notice notice-warning">
              <strong>Advanced research assumptions</strong>
              <ul>
                {result.assumptions.map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="metric-grid">
            <div className="metric">
              <span className="metric-label">Gross blended APY</span>
              <strong className="metric-value">{formatPercent(result.grossBlendedApy)}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Net blended APY</span>
              <strong className="metric-value">{formatPercent(result.netBlendedApy)}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Comparative risk-adjusted APY</span>
              <strong className="metric-value">{formatPercent(result.riskAdjustedApy)}</strong>
            </div>
            <div className="metric">
              <span className="metric-label">Weighted risk</span>
              <strong className="metric-value">{formatRisk(result.weightedRiskScore)}</strong>
            </div>
          </div>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Route</th>
                  <th className="numeric" scope="col">
                    Allocation
                  </th>
                  <th className="numeric" scope="col">
                    Risk-adjusted APY
                  </th>
                  <th scope="col">Risk</th>
                  <th scope="col">Rationale</th>
                </tr>
              </thead>
              <tbody>
                {result.allocations.map((allocation) => (
                  <tr key={allocation.routeSlug}>
                    <td>
                      <strong>{allocation.productName}</strong>
                      <br />
                      <span className="faint">{allocation.routeName}</span>
                    </td>
                    <td className="numeric">{allocation.percentage}%</td>
                    <td className="numeric">{formatPercent(allocation.riskAdjustedApy)}</td>
                    <td>{formatRisk(allocation.riskScore)}</td>
                    <td>{allocation.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid grid-3" style={{ marginTop: 18 }}>
            <div className="card">
              <span className="label">Immediate liquidity</span>
              <h3 style={{ marginTop: 10 }}>{result.immediateLiquidity}%</h3>
            </div>
            <div className="card">
              <span className="label">Within 24 hours</span>
              <h3 style={{ marginTop: 10 }}>{result.twentyFourHourLiquidity}%</h3>
            </div>
            <div className="card">
              <span className="label">Within seven days</span>
              <h3 style={{ marginTop: 10 }}>{result.sevenDayLiquidity}%</h3>
            </div>
          </div>
          <p className="faint" style={{ fontSize: 11 }}>
            Methodology {result.methodologyVersion} · data cutoff {result.dataTimestamp}
          </p>
        </section>
      ) : null}
      {saveMessage ? (
        <p aria-live="polite" className="legal-strip">
          {saveMessage}
        </p>
      ) : null}
    </>
  );
}
