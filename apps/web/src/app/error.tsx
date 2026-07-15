"use client";

import { AlertTriangle } from "lucide-react";

export default function ErrorPage({
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="data-state">
      <AlertTriangle aria-hidden size={28} style={{ color: "var(--warning)", margin: "0 auto" }} />
      <span className="eyebrow">Controlled error</span>
      <h1>This view could not be prepared safely</h1>
      <p>
        No missing value was substituted and no partial mutation was committed. Retry the request or
        inspect data health.
      </p>
      <button className="button button-primary" onClick={reset} type="button">
        Try again
      </button>
    </div>
  );
}
