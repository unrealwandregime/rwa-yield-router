import { getServerConfig } from "@rwa-yield-router/config";
import { Badge, Metric } from "@rwa-yield-router/ui";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { catalogStats } from "@/lib/catalog";
import { CATEGORY_META, CATEGORY_VALUES } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format";
import { getLiveCatalog } from "@/lib/live-morpho";

export const dynamic = "force-dynamic";
export const metadata = { title: "Data health" };

const configurationState = (configured: boolean) =>
  configured ? (
    <Badge tone="positive">Configured</Badge>
  ) : (
    <Badge tone="warning">Not configured</Badge>
  );

export default async function StatusPage() {
  const config = getServerConfig();
  const records = await getLiveCatalog();
  const stats = catalogStats(records);
  const current = records.filter(
    (record) => record.publicationStatus === "PUBLISHED" && record.observedAt !== null
  ).length;
  const latest =
    records
      .map((record) => record.observedAt ?? record.verifiedAt)
      .sort((a, b) => b.localeCompare(a))[0] ?? null;
  return (
    <>
      <PageHeader
        description="Provider configuration, catalog admission, and current observation coverage. Provider degradation does not erase the last valid sourced record."
        eyebrow="Operational transparency"
        title="Data and service health"
      />
      <div className="metric-grid">
        <Metric
          detail={
            config.deploymentTier === "preview"
              ? "Free services may sleep; this is not a production release"
              : "Production release controls apply"
          }
          label="Deployment tier"
          value={config.deploymentTier === "preview" ? "Preview" : "Production"}
        />
        <Metric
          detail={`${stats.researchedCategories}/${CATEGORY_VALUES.length} categories contain sourced candidates`}
          label="Research records"
          value={stats.researched}
        />
        <Metric
          detail={`${stats.admittedCategories}/${CATEGORY_VALUES.length} categories have admitted identity metadata`}
          label="Admitted records"
          value={stats.admitted}
        />
        <Metric
          detail="Have a current provider observation"
          label="Live observations"
          value={current}
        />
        <Metric
          detail="Require additional admission evidence"
          label="Gated records"
          value={stats.gated}
        />
        <Metric
          detail={formatTimestamp(latest)}
          label="Latest data event"
          value={current > 0 ? "Live" : "Catalog only"}
        />
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Admission coverage</span>
            <h2>Research is not publication</h2>
            <p>
              Every category has sourced research, but a category counts as admitted only when at
              least one record has passed the catalog publication gate. Financial observations are a
              separate requirement.
            </p>
          </div>
        </div>
        <div
          aria-label="Researched, admitted, and gated catalog records by category"
          className="table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="data-table">
            <caption className="sr-only">
              Researched, admitted, and gated catalog records by category
            </caption>
            <thead>
              <tr>
                <th scope="col">Category</th>
                <th className="numeric" scope="col">
                  Researched
                </th>
                <th className="numeric" scope="col">
                  Admitted
                </th>
                <th className="numeric" scope="col">
                  Gated
                </th>
                <th scope="col">Release coverage</th>
              </tr>
            </thead>
            <tbody>
              {CATEGORY_VALUES.map((category) => {
                const coverage = stats.categoryCoverage[category];
                return (
                  <tr key={category}>
                    <td>{CATEGORY_META[category].label}</td>
                    <td className="numeric">{coverage.researched}</td>
                    <td className="numeric">{coverage.admitted}</td>
                    <td className="numeric">{coverage.gated}</td>
                    <td>
                      <Badge tone={coverage.admitted > 0 ? "positive" : "warning"}>
                        {coverage.admitted > 0 ? "Admitted coverage" : "Research only"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Dependencies</span>
            <h2>Configured runtime services</h2>
          </div>
        </div>
        <div
          aria-label="Configured runtime services and failure behavior"
          className="table-wrap"
          role="region"
          tabIndex={0}
        >
          <table className="data-table">
            <caption className="sr-only">Configured runtime services and failure behavior</caption>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">Purpose</th>
                <th scope="col">State</th>
                <th scope="col">Failure behavior</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Outbound notifications</strong>
                </td>
                <td>Informational alert delivery</td>
                <td>{configurationState(config.email.transport !== "disabled")}</td>
                <td>Rules remain auditable; no message is sent while disabled</td>
              </tr>
              <tr>
                <td>
                  <strong>Research catalog bundle</strong>
                </td>
                <td>Sourced discovery and admitted identity metadata</td>
                <td>
                  <Badge
                    tone={
                      stats.admittedCategories === CATEGORY_VALUES.length ? "positive" : "warning"
                    }
                  >
                    {stats.admittedCategories}/{CATEGORY_VALUES.length} categories admitted
                  </Badge>
                </td>
                <td>Invalid bundles fail; gated research remains unavailable to routing</td>
              </tr>
              <tr>
                <td>
                  <strong>PostgreSQL</strong>
                </td>
                <td>Observations, history, accounts, audit</td>
                <td>
                  <span className="stack">
                    {configurationState(config.databaseUrl !== undefined)}
                    <Link className="source-link" href="/health/ready">
                      Check schema and catalog bootstrap
                    </Link>
                  </span>
                </td>
                <td>Readiness fails when schema or catalog bootstrap is incomplete</td>
              </tr>
              <tr>
                <td>
                  <strong>Redis / worker</strong>
                </td>
                <td>Ingestion, jobs, alerts, cache</td>
                <td>{configurationState(config.redisUrl !== undefined)}</td>
                <td>History remains readable; freshness degrades</td>
              </tr>
              <tr>
                <td>
                  <strong>Morpho official API</strong>
                </td>
                <td>Vault and lending observations</td>
                <td>{configurationState(config.requestTimeProviderFetchEnabled)}</td>
                <td>Last value ages to stale; circuit opens</td>
              </tr>
              <tr>
                <td>
                  <strong>Ethereum read RPC</strong>
                </td>
                <td>Contract and wallet balance reads</td>
                <td>{configurationState(config.rpcUrls.ethereum !== undefined)}</td>
                <td>Wallet analysis explicitly disables</td>
              </tr>
              <tr>
                <td>
                  <strong>Supabase Auth</strong>
                </td>
                <td>Passwordless identity</td>
                <td>
                  {configurationState(
                    config.supabaseUrl !== undefined && config.supabaseAnonKey !== undefined
                  )}
                </td>
                <td>Protected actions fail closed</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="section grid grid-2">
        <article className="panel">
          <span className="eyebrow">Health semantics</span>
          <h2>Liveness is not freshness</h2>
          <p>
            The liveness endpoint proves the process is responsive. Readiness checks dependencies
            required for safe request handling. Provider health is reported separately so an
            upstream outage cannot make historical research disappear.
          </p>
        </article>
        <article className="panel">
          <span className="eyebrow">Data incidents</span>
          <h2>Last known values keep their status</h2>
          <p>
            When a provider fails, circuit breaking and source fallback run per capability. The last
            selected observation becomes stale at its metric-specific threshold and remains
            timestamped. Missing data never silently becomes zero.
          </p>
        </article>
      </section>
    </>
  );
}
