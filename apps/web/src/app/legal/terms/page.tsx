import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <>
      <PageHeader
        description="Working product terms. Professional legal review is required before commercial scale."
        eyebrow="Legal · review required"
        title="Terms of use"
      />
      <article className="legal-document panel">
        <h2>Permitted use</h2>
        <p>
          You may use the service for lawful research and analysis. You remain responsible for
          validating product terms, eligibility, data, taxes, and any independent decision made
          outside the platform.
        </p>
        <h2>Prohibited use</h2>
        <p>
          You may not attempt to bypass authentication or rate limits, interfere with ingestion or
          alerts, inject malicious content, enumerate private objects, misrepresent platform
          analysis as a guarantee, or use the service to violate laws or third-party rights.
        </p>
        <h2>Third parties</h2>
        <p>
          Issuer, protocol, explorer, data-provider, email, and Telegram links and services are
          independent. Their availability, content, security, and terms are outside the platform’s
          control.
        </p>
        <h2>No warranties</h2>
        <p>
          The service and its data are provided for informational use. Data may be incomplete,
          stale, estimated, or unavailable. Nothing in the service guarantees returns, liquidity,
          redemption, eligibility, or principal value.
        </p>
        <h2>Changes and suspension</h2>
        <p>
          Methodologies, providers, and functionality may change through versioned releases. A
          product or route may be paused, archived, or excluded when its evidence or operating state
          no longer satisfies admission requirements.
        </p>
      </article>
    </>
  );
}
