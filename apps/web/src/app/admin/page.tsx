import { AdminCatalogManager } from "@/components/admin-catalog-manager";
import { PageHeader } from "@/components/page-header";
import { AdminGate } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false }, title: "Administration" };

export default function AdminPage() {
  return (
    <>
      <PageHeader
        description="Server-authorized catalog, source, methodology, job, alert-delivery, and audit operations."
        eyebrow="Restricted administration"
        title="Operations console"
      />
      <AdminGate>
        <AdminCatalogManager />
      </AdminGate>
    </>
  );
}
