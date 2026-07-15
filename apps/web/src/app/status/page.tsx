import { Badge, Metric } from "@rwa-yield-router/ui";
import { PageHeader } from "@/components/page-header";
import { catalogStats } from "@/lib/catalog";
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
  const stats = catalogStats();
  const records = await getLiveCatalog();
  const current = records.filter((record) => record.observedAt !== null).length;
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
          detail="Identity and source metadata"
          label="Published records"
          value={stats.published}
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
            <span className="eyebrow">Dependencies</span>
            <h2>Configured runtime services</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
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
                  <strong>Verified catalog bundle</strong>
                </td>
                <td>Official product and route identity</td>
                <td>
                  <Badge tone="positive">Operational</Badge>
                </td>
                <td>Build fails if schema or source validation fails</td>
              </tr>
              <tr>
                <td>
                  <strong>PostgreSQL</strong>
                </td>
                <td>Observations, history, accounts, audit</td>
                <td>{configurationState(Boolean(process.env.DATABASE_URL))}</td>
                <td>Readiness fails; public catalog remains safe</td>
              </tr>
              <tr>
                <td>
                  <strong>Redis / worker</strong>
                </td>
                <td>Ingestion, jobs, alerts, cache</td>
                <td>{configurationState(Boolean(process.env.REDIS_URL))}</td>
                <td>History remains readable; freshness degrades</td>
              </tr>
              <tr>
                <td>
                  <strong>Morpho official API</strong>
                </td>
                <td>Vault and lending observations</td>
                <td>{configurationState(Boolean(process.env.MORPHO_API_URL))}</td>
                <td>Last value ages to stale; circuit opens</td>
              </tr>
              <tr>
                <td>
                  <strong>Ethereum read RPC</strong>
                </td>
                <td>Contract and wallet balance reads</td>
                <td>{configurationState(Boolean(process.env.RPC_URL_ETHEREUM))}</td>
                <td>Wallet analysis explicitly disables</td>
              </tr>
              <tr>
                <td>
                  <strong>Supabase Auth</strong>
                </td>
                <td>Passwordless identity</td>
                <td>
                  {configurationState(
                    Boolean(
                      process.env.NEXT_PUBLIC_SUPABASE_URL &&
                      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
                    )
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
