import { Badge, type BadgeTone } from "@rwa-yield-router/ui";

export function ConfidenceBadge({ confidence }: { confidence: string }) {
  const tone: BadgeTone = confidence.includes("OFFICIAL")
    ? "positive"
    : confidence.includes("UNAVAILABLE") || confidence.includes("STALE")
      ? "warning"
      : "info";
  return <Badge tone={tone}>{confidence.replaceAll("_", " ")}</Badge>;
}
