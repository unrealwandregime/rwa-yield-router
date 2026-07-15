import Link from "next/link";

export default function NotFound() {
  return (
    <div className="data-state">
      <span className="eyebrow">404 · Not found</span>
      <h1>This research record is not published</h1>
      <p>
        The link may be invalid, archived, or still behind an admission gate. Unverified records are
        not exposed as live products.
      </p>
      <Link className="button button-primary" href="/screener">
        Return to screener
      </Link>
    </div>
  );
}
