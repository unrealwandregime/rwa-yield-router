import { readFile } from "node:fs/promises";

import { z } from "zod";

const catalogSourceSchema = z.object({
  name: z.string().trim().min(1),
  type: z.string().trim().min(1),
  url: z.url()
});

const catalogDocumentSchema = z.object({
  records: z.array(
    z.tuple([z.string(), ...Array.from({ length: 12 }, () => z.unknown()), z.string()])
  ),
  sourceVerifiedAt: z
    .record(z.string(), z.iso.datetime({ offset: true }))
    .optional()
    .default({}),
  sources: z.record(z.string(), catalogSourceSchema),
  verifiedAt: z.iso.datetime({ offset: true })
});

const args = new Set(process.argv.slice(2));
const liveLinks = args.has("--live-links") || process.env.MAINTENANCE_LIVE_LINK_CHECKS === "true";
const maxAgeDays = Number.parseInt(process.env.MAX_MANUAL_METADATA_AGE_DAYS ?? "120", 10);
const catalogPath = new URL(
  "../packages/data-adapters/data/production-catalog.json",
  import.meta.url
);
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function validateUrl(sourceId: string, rawUrl: string): URL | undefined {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "https:") fail(`${sourceId} must use HTTPS`);
  if (parsed.username !== "" || parsed.password !== "")
    fail(`${sourceId} URL must not include credentials`);
  if (parsed.hostname.includes("*")) fail(`${sourceId} URL must not include wildcard hosts`);
  return parsed;
}

function validateFreshness(sourceId: string, verifiedAt: string, now: Date): void {
  const ageMs = now.getTime() - new Date(verifiedAt).getTime();
  if (ageMs < 0) {
    fail(`${sourceId} verification timestamp is in the future`);
    return;
  }
  const ageDays = ageMs / 86_400_000;
  if (ageDays > maxAgeDays) {
    fail(`${sourceId} verification timestamp is ${ageDays.toFixed(1)} days old`);
  }
}

async function probeLink(sourceId: string, url: URL): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    let response = await fetch(url, {
      headers: { Accept: "text/html,application/json,application/pdf,*/*;q=0.1" },
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal
    });
    if (response.status === 405 || response.status === 403) {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/json,application/pdf,*/*;q=0.1",
          Range: "bytes=0-2047"
        },
        method: "GET",
        redirect: "manual",
        signal: controller.signal
      });
    }
    if (response.status < 200 || response.status >= 400) {
      fail(`${sourceId} link probe returned HTTP ${response.status}`);
    }
  } catch (error) {
    fail(`${sourceId} link probe failed: ${error instanceof Error ? error.name : "unknown error"}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  const rawDocument = JSON.parse(await readFile(catalogPath, "utf8"));
  const catalog = catalogDocumentSchema.parse(rawDocument);
  const now = new Date();
  const referencedSourceIds = new Set(catalog.records.map((record) => record[13]));
  const uniqueUrls = new Map<string, string>();

  validateFreshness("catalog", catalog.verifiedAt, now);

  for (const sourceId of referencedSourceIds) {
    if (catalog.sources[sourceId] === undefined)
      fail(`Record references missing source ${sourceId}`);
  }

  for (const [sourceId, source] of Object.entries(catalog.sources)) {
    const parsed = validateUrl(sourceId, source.url);
    validateFreshness(sourceId, catalog.sourceVerifiedAt[sourceId] ?? catalog.verifiedAt, now);
    if (uniqueUrls.has(source.url)) {
      fail(`${sourceId} duplicates source URL used by ${uniqueUrls.get(source.url)}`);
    }
    uniqueUrls.set(source.url, sourceId);
    if (liveLinks && parsed !== undefined) await probeLink(sourceId, parsed);
  }

  if (failures.length > 0) {
    console.error("Scheduled maintenance checks failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `Scheduled maintenance checks passed: ${catalog.records.length} records, ${Object.keys(catalog.sources).length} sources, liveLinks=${liveLinks}`
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
