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

const publicBaseUrlSchema = z.url().refine(
  (value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === ""
    );
  },
  { message: "SMOKE_BASE_URL must be a canonical HTTPS origin" }
);

const normalizedBase = new URL(publicBaseUrlSchema.parse(baseUrl)).origin;
const routePageSchema = z.object({
  data: z.array(z.object({ slug: z.string().min(1) })).min(2)
});
const comparisonSchema = z.object({
  data: z.array(z.object({ slug: z.string().min(1) })).length(2)
});
const historySchema = z.object({
  data: z.array(
    z.object({ netApy: z.string(), observedAt: z.string(), routeSlug: z.string().min(1) })
  )
});

async function fetchPublic(path: string): Promise<Response> {
  return fetch(`${normalizedBase}${path}`, {
    headers: { "user-agent": "rwa-yield-router-smoke/1" },
    redirect: "error",
    signal: AbortSignal.timeout(15_000)
  });
}

async function run(): Promise<void> {
  const failures: string[] = [];

  for (const [path, expected] of targets) {
    try {
      const response = await fetchPublic(path);
      if (response.status !== expected)
        failures.push(`${path}: expected ${expected}, received ${response.status}`);
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : "request failed"}`);
    }
  }

  try {
    const routesResponse = await fetchPublic("/api/v1/routes?limit=2");
    if (!routesResponse.ok) throw new Error(`route discovery returned ${routesResponse.status}`);
    const routes = routePageSchema
      .parse(await routesResponse.json())
      .data.map((route) => route.slug);
    const comparisonPath = `/api/v1/comparison?routes=${routes.map(encodeURIComponent).join(",")}`;
    const comparisonResponse = await fetchPublic(comparisonPath);
    if (!comparisonResponse.ok) throw new Error(`comparison returned ${comparisonResponse.status}`);
    comparisonSchema.parse(await comparisonResponse.json());

    const historyPath = `/api/v1/historical-yield?route=${encodeURIComponent(routes[0] ?? "")}`;
    const historyResponse = await fetchPublic(historyPath);
    if (!historyResponse.ok) throw new Error(`historical yield returned ${historyResponse.status}`);
    historySchema.parse(await historyResponse.json());
  } catch (error) {
    failures.push(
      `public API journeys: ${error instanceof Error ? error.message : "response validation failed"}`
    );
  }

  if (failures.length > 0) throw new Error(`Smoke checks failed:\n${failures.join("\n")}`);
  process.stdout.write(
    `Smoke checks passed for ${targets.length} public endpoints and 2 sourced API journeys at ${normalizedBase}.\n`
  );
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Smoke checks failed."}\n`);
  process.exitCode = 1;
});
