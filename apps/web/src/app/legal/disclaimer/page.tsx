import { PageHeader } from "@/components/page-header";

export const metadata = { title: "Legal disclaimer" };

export default function DisclaimerPage() {
  return (
    <>
      <PageHeader
        description="Working product notice. Professional legal review is required before commercial scale."
        eyebrow="Legal · review required"
        title="Informational analytics, not investment advice"
      />
      <article className="legal-document panel">
        <h2>Analytical scope</h2>
        <p>
          RWA Yield Router provides general informational and analytical research. It does not
          provide individualized investment, legal, tax, or accounting advice and does not recommend
          any product as suitable for a particular person.
        </p>
        <h2>No custody or execution</h2>
        <p>
          The platform does not accept deposits, take custody, hold private keys, request approvals,
          sign transactions, or execute swaps, deposits, withdrawals, or rebalances. Any link to an
          issuer or protocol leads to an independent third party.
        </p>
        <h2>Variable and incomplete data</h2>
        <p>
          APYs are variable. Historical observations do not guarantee future results. Third-party
          and on-chain data can be delayed, incomplete, inaccurate, unavailable, or affected by
          provider failure. Users must verify current terms directly with the issuer or protocol.
        </p>
        <h2>Comparative methodology</h2>
        <p>
          Comparative risk-adjusted APY is a transparent platform ranking methodology, not an
          expected-return forecast, probability of loss, credit rating, or guarantee. Comparative
          risk scores do not establish that any product is safe.
        </p>
        <h2>Eligibility</h2>
        <p>
          Product availability depends on jurisdiction, investor classification, KYC, transfer
          restrictions, and changing legal terms. An eligibility label is informational; users must
          confirm access directly with the product provider before acting.
        </p>
      </article>
    </>
  );
}
