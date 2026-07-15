"use client";

import { Eye, WalletCards } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { browserFetch } from "@/lib/browser-fetch";
import type { WalletChain } from "@/lib/wallet-analysis";

const resultSchema = z.object({
  address: z.string(),
  chain: z.enum(["ethereum", "base"]),
  coverage: z.string(),
  coverageStatus: z.enum(["COMPLETE_FOR_SUPPORTED_ROUTES", "PARTIAL"]),
  dataTimestamp: z.string(),
  exposureSummary: z.object({
    categories: z.array(z.string()),
    chains: z.array(z.enum(["ethereum", "base"])),
    issuers: z.array(z.string()),
    protocols: z.array(z.string()),
    weighting: z.literal("UNWEIGHTED_RECOGNIZED_POSITIONS_ONLY")
  }),
  failedRouteReads: z.number().int().nonnegative(),
  holdings: z.array(
    z.object({
      balance: z.string(),
      category: z.string(),
      chain: z.enum(["ethereum", "base"]),
      currentNetApy: z.string().nullable(),
      currentYieldConfidence: z.string(),
      currentYieldObservedAt: z.string().nullable(),
      currentYieldStatus: z.string(),
      issuer: z.string(),
      productName: z.string(),
      protocol: z.string().nullable(),
      routeName: z.string(),
      routeSlug: z.string(),
      shareTokenAddress: z.string(),
      shareTokenSymbol: z.string()
    })
  ),
  limitations: z.array(z.string()),
  supportedRoutesScanned: z.number().int().nonnegative(),
  unrecognizedCount: z.null()
});

const chainLabel = (chain: WalletChain) => (chain === "ethereum" ? "Ethereum" : "Base");

export function WalletAnalysisForm({ enabledChains }: { enabledChains: readonly WalletChain[] }) {
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<z.infer<typeof resultSchema> | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setResult(null);
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const response = await browserFetch("/api/v1/wallet-analysis", {
        body: JSON.stringify({ address: form.get("address"), chain: form.get("chain") }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      const body: unknown = await response.json();
      const parsed = resultSchema.safeParse(body);
      if (!response.ok || !parsed.success) {
        setMessage(
          "Read-only analysis could not be completed. No signature or approval was requested."
        );
        return;
      }
      setResult(parsed.data);
    } catch {
      setMessage(
        "The read-only provider could not be reached. No signature or approval was requested."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (enabledChains.length === 0)
    return (
      <div className="data-state">
        <Eye aria-hidden size={26} style={{ margin: "0 auto", color: "var(--accent)" }} />
        <span className="eyebrow">Explicitly disabled</span>
        <h2>No supported read-only RPC is configured</h2>
        <p>
          Wallet analysis remains disabled rather than sending addresses to an unapproved provider.
          Configure a supported public RPC to enable balance reads.
        </p>
      </div>
    );

  return (
    <>
      <form className="panel" onSubmit={submit}>
        <span className="eyebrow">Read-only lookup</span>
        <h2>Analyze a public address</h2>
        <p>No signature, approval, or executable transaction is requested or constructed.</p>
        <div className="form-grid">
          <label className="field">
            <span>Public wallet address</span>
            <input
              autoComplete="off"
              className="input mono"
              name="address"
              pattern="^0x[a-fA-F0-9]{40}$"
              placeholder="0x…"
              required
              spellCheck={false}
            />
          </label>
          <label className="field">
            <span>Chain</span>
            <select className="select" name="chain">
              {enabledChains.map((chain) => (
                <option key={chain} value={chain}>
                  {chainLabel(chain)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <button
          className="button button-primary"
          disabled={submitting}
          style={{ marginTop: 18 }}
          type="submit"
        >
          <WalletCards aria-hidden size={15} />
          {submitting ? "Reading supported contracts…" : "Analyze holdings"}
        </button>
        {message ? (
          <p aria-live="polite" className="legal-strip">
            {message}
          </p>
        ) : null}
      </form>

      {result ? (
        <section className="panel" style={{ marginTop: 18 }}>
          <span className="eyebrow">Coverage report</span>
          <h2>{result.holdings.length} recognized positions</h2>
          <p>
            {result.coverage} {result.supportedRoutesScanned} supported contracts were checked.
          </p>
          {result.coverageStatus === "PARTIAL" ? (
            <p className="legal-strip" role="status">
              Partial result: {result.failedRouteReads} supported contract reads failed. A zero
              recognized balance must not be interpreted as a complete wallet inventory.
            </p>
          ) : null}
          {result.holdings.length === 0 ? (
            <div className="data-state">
              <h3>No supported vault-share balance was found</h3>
              <p>This does not mean the address has no other assets or positions.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">Recognized route</th>
                    <th scope="col">Share token</th>
                    <th className="numeric" scope="col">
                      Share balance
                    </th>
                    <th className="numeric" scope="col">
                      Current net APY
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.holdings.map((holding) => (
                    <tr key={holding.routeSlug}>
                      <td>
                        <strong>{holding.productName}</strong>
                        <small>{holding.routeName}</small>
                      </td>
                      <td>{holding.shareTokenSymbol}</td>
                      <td className="numeric mono">{holding.balance}</td>
                      <td className="numeric">
                        {holding.currentNetApy === null
                          ? "Unavailable"
                          : `${holding.currentNetApy}% (${holding.currentYieldStatus.toLowerCase()})`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.holdings.length > 0 ? (
            <div className="detail-grid" style={{ marginTop: 18 }}>
              <div className="detail-card">
                <span className="eyebrow">Unweighted exposure labels</span>
                <p>
                  Categories: {result.exposureSummary.categories.join(", ") || "Unavailable"}
                  <br />
                  Issuers: {result.exposureSummary.issuers.join(", ") || "Unavailable"}
                  <br />
                  Protocols: {result.exposureSummary.protocols.join(", ") || "Unavailable"}
                </p>
              </div>
              <div className="detail-card">
                <span className="eyebrow">Concentration</span>
                <p>
                  USD-weighted concentration is unavailable because share-token conversion and
                  pricing are outside this bounded read.
                </p>
              </div>
            </div>
          ) : null}
          <div className="legal-strip" style={{ marginTop: 18 }}>
            <strong>Coverage limitations</strong>
            <ul>
              {result.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </>
  );
}
