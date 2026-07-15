import { AccountGate } from "@/components/account-gate";
import { PageHeader } from "@/components/page-header";
import { WatchlistManager } from "@/components/watchlist-manager";
import { getAdmittedCatalog } from "@/lib/catalog";

export const metadata = { robots: { index: false }, title: "Watchlist" };

export default function WatchlistPage() {
  return (
    <>
      <PageHeader
        description="Keep a private list of routes whose current data, access, or risk changes you want to revisit."
        eyebrow="Private workspace"
        title="Watchlist"
      />
      <AccountGate>
        <WatchlistManager records={getAdmittedCatalog()} />
      </AccountGate>
    </>
  );
}
