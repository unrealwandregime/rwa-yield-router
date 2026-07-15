import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <>
      <PageHeader
        description="Working product policy. Professional privacy and legal review is required before commercial scale."
        eyebrow="Legal · review required"
        title="Privacy policy"
      />
      <article className="legal-document panel">
        <h2>Data we process</h2>
        <p>
          Public browsing does not require an account. If you sign in, the authentication provider
          processes your email and the application stores a provider subject, preferences,
          watchlists, saved comparisons, simulations, and alert settings. Read-only wallet analysis
          processes only the public address and supported-chain balances you explicitly request.
        </p>
        <h2>Data we never request</h2>
        <p>
          We never request or store private keys, seed phrases, token approvals, or wallet
          signatures merely to connect.
        </p>
        <h2>Operational data</h2>
        <p>
          Security and reliability logs may contain timestamps, correlation identifiers, coarse
          request metadata, and redacted errors. Secrets, session tokens, unnecessary personal data,
          and full provider payloads are excluded from logs.
        </p>
        <h2>Retention and deletion</h2>
        <p>
          Account data is retained while the account is active and for the limited operational
          periods documented in the security policy. A deletion request removes or irreversibly
          anonymizes user-owned data subject to legitimate security, audit, and legal obligations.
        </p>
        <h2>Processors</h2>
        <p>
          Configured infrastructure, authentication, email, Telegram, monitoring, database, and
          hosting providers act as processors under their own terms. The deployed service must
          publish the current provider list before commercial scale.
        </p>
      </article>
    </>
  );
}
