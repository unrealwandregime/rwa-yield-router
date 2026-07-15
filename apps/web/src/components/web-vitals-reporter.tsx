"use client";

import { useReportWebVitals } from "next/web-vitals";

import { browserFetch } from "@/lib/browser-fetch";
import { normalizeWebVital } from "@/lib/web-vitals";

function reportWebVital(metric: unknown): void {
  const payload = normalizeWebVital(metric);
  if (payload === null) return;
  void browserFetch("/api/v1/web-vitals", {
    body: JSON.stringify(payload),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST"
  }).catch(() => undefined);
}

export function WebVitalsReporter() {
  useReportWebVitals(reportWebVital);
  return null;
}
