import { Metric } from "@rwa-yield-router/ui";
import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { RecordTable } from "@/components/record-table";
import { CATEGORY_META, CATEGORY_VALUES, categoryFromSlug, categorySlug } from "@/lib/constants";
import { formatTimestamp } from "@/lib/format";
import { getLiveCatalog } from "@/lib/live-morpho";

type PageProps = { params: Promise<{ category: string }> };

export const generateStaticParams = () =>
  CATEGORY_VALUES.map((category) => ({ category: categorySlug(category) }));

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const category = categoryFromSlug((await params).category);
  return category
    ? { title: CATEGORY_META[category].label, description: CATEGORY_META[category].description }
    : {};
}

export default async function CategoryPage({ params }: PageProps) {
  const category = categoryFromSlug((await params).category);
  if (!category) notFound();
  const records = (await getLiveCatalog()).filter((record) => record.category === category);
  const latest =
    records.map((record) => record.verifiedAt).sort((a, b) => b.localeCompare(a))[0] ?? null;

  return (
    <>
      <PageHeader
        actions={
          <Link className="button button-primary" href={`/screener?category=${category}`}>
            Filter in screener <ArrowRight aria-hidden size={15} />
          </Link>
        }
        description={CATEGORY_META[category].description}
        eyebrow="Category research"
        title={CATEGORY_META[category].label}
      />
      <div className="metric-grid">
        <Metric
          detail="Sourced research records; admission status remains visible"
          label="Routes"
          value={records.length}
        />
        <Metric detail="No estimate substituted" label="Median gross APY" value="Unavailable" />
        <Metric
          detail="No missing value treated as zero"
          label="Tracked AUM / TVL"
          value="Unavailable"
        />
        <Metric detail={formatTimestamp(latest)} label="Catalog verified" value="Manual review" />
      </div>
      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Sourced routes</span>
            <h2>Current research universe</h2>
          </div>
        </div>
        <RecordTable records={records} />
      </section>
    </>
  );
}
