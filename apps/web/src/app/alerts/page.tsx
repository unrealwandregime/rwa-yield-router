import { AccountGate } from "@/components/account-gate";
import { AlertRuleForm } from "@/components/alert-rule-form";
import { PageHeader } from "@/components/page-header";
import { NotificationInbox } from "@/components/notification-inbox";
import { getAdmittedCatalog } from "@/lib/catalog";

export const metadata = { robots: { index: false }, title: "Alerts" };

export default function AlertsPage() {
  return (
    <>
      <PageHeader
        description="Create deduplicated informational alerts with cooldowns, delivery logs, retries, and user-timezone support."
        eyebrow="Private workspace"
        title="Alerts"
      />
      <AccountGate>
        <div className="stack">
          <AlertRuleForm records={getAdmittedCatalog()} />
          <NotificationInbox />
        </div>
      </AccountGate>
    </>
  );
}
