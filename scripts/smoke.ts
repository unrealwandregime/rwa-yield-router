import { z } from "zod";

const baseUrl = process.env.SMOKE_BASE_URL ?? process.argv[2];
if (!baseUrl)
  throw new Error("Set SMOKE_BASE_URL or pass the public base URL as the first argument.");

const targets = [
  ["/health/live", 200],
  ["/health/ready", 200],
  ["/", 200],
  ["/dashboard", 200],
  ["/screener", 200],
  ["/compare", 200],
  ["/simulator", 200],
  ["/methodology", 200],
  ["/sources", 200],
  ["/status", 200],
  ["/api/v1/categories", 200],
  ["/api/openapi", 200],
  ["/robots.txt", 200],
  ["/sitemap.xml", 200]
] as const;

const normalizedBase = z.url().parse(baseUrl).replace(/\/$/u, "");
const failures: string[] = [];

for (const [path, expected] of targets) {
  try {
    const response = await fetch(`${normalizedBase}${path}`, {
      headers: { "user-agent": "rwa-yield-router-smoke/1" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000)
    });
    if (response.status !== expected)
      failures.push(`${path}: expected ${expected}, received ${response.status}`);
  } catch (error) {
    failures.push(`${path}: ${error instanceof Error ? error.message : "request failed"}`);
  }
}

if (failures.length > 0) throw new Error(`Smoke checks failed:\n${failures.join("\n")}`);
process.stdout.write(
  `Smoke checks passed for ${targets.length} public endpoints at ${normalizedBase}.\n`
);
