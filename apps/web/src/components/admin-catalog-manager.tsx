"use client";

import { CATEGORY_WEIGHTS_V1, RISK_FACTORS } from "@rwa-yield-router/risk-engine";
import { Metric } from "@rwa-yield-router/ui";
import { Archive, Download, Pencil, Plus, RefreshCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import {
  adminActionSchema,
  adminSnapshotSchema,
  investorClassificationValues,
  lifecycleStatusValues,
  securitySnapshotSchema,
  sourceTypeValues,
  type AdminSnapshot
} from "@/lib/admin-contract";
import { browserFetch } from "@/lib/browser-fetch";
import { CATEGORY_META, CATEGORY_VALUES } from "@/lib/constants";

const errorEnvelopeSchema = z
  .object({
    error: z
      .object({
        code: z.string(),
        correlationId: z.string(),
        message: z.string()
      })
      .passthrough()
  })
  .passthrough();

const today = (): string => new Date().toISOString().slice(0, 10);
const verificationInstant = (date: string): string => `${date}T00:00:00.000Z`;
const nullableText = (value: FormDataEntryValue | null): string | null => {
  const text = String(value ?? "").trim();
  return text.length === 0 ? null : text;
};
const nullableInteger = (value: FormDataEntryValue | null): number | null => {
  const text = nullableText(value);
  return text === null ? null : Number(text);
};
const nullableBoolean = (value: FormDataEntryValue | null): boolean | null =>
  value === "true" ? true : value === "false" ? false : null;

const defaultWeights = CATEGORY_VALUES.flatMap((category) =>
  RISK_FACTORS.map((factorCode) => ({
    category,
    factorCode,
    weightPct: CATEGORY_WEIGHTS_V1[category][factorCode]
  }))
);

async function responseError(response: Response): Promise<string> {
  try {
    const parsed = errorEnvelopeSchema.safeParse(await response.json());
    if (parsed.success) return `${parsed.data.error.message} (${parsed.data.error.correlationId})`;
  } catch {
    // The stable fallback below avoids exposing an unvalidated response body.
  }
  return `Request failed with HTTP ${response.status}.`;
}

export function AdminCatalogManager() {
  const [snapshot, setSnapshot] = useState<AdminSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [publicationFilter, setPublicationFilter] = useState("ALL");
  const [lifecycleFilter, setLifecycleFilter] = useState("ALL");
  const [evidenceSourceId, setEvidenceSourceId] = useState("");
  const [entityType, setEntityType] = useState<"CHAIN" | "CUSTODIAN" | "ISSUER" | "PROTOCOL">(
    "ISSUER"
  );
  const [accessKind, setAccessKind] = useState<"ELIGIBILITY" | "REDEMPTION" | "SOURCE_LINK">(
    "ELIGIBILITY"
  );
  const [securityEvents, setSecurityEvents] = useState<
    z.infer<typeof securitySnapshotSchema>["data"] | null
  >(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await browserFetch("/api/internal/admin/overview", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const parsed = adminSnapshotSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("The admin overview response failed schema validation.");
      setSnapshot(parsed.data.data);
      const defaultEvidenceSource = parsed.data.data.sources.find(
        (source) =>
          source.status !== "REMOVED" &&
          (source.publicationStatus === "REVIEWED" || source.publicationStatus === "PUBLISHED")
      );
      setEvidenceSourceId((current) => current || defaultEvidenceSource?.id || "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Administrative data is unavailable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  const runAction = async (rawAction: unknown, successMessage: string) => {
    const action = adminActionSchema.safeParse(rawAction);
    if (!action.success) {
      setError(action.error.issues.map((issue) => issue.message).join(" "));
      return false;
    }
    setPending(true);
    setError(null);
    try {
      const response = await browserFetch("/api/internal/admin/actions", {
        body: JSON.stringify(action.data),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage(successMessage);
      await refresh();
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Administrative action failed safely.");
      return false;
    } finally {
      setPending(false);
    }
  };

  const filteredCatalog = useMemo(() => {
    if (!snapshot) return [];
    const query = search.trim().toLowerCase();
    return snapshot.catalog.filter(
      (record) =>
        (query.length === 0 ||
          [record.productName, record.routeName, record.symbol, record.issuer, record.protocol]
            .filter((value): value is string => value !== null)
            .some((value) => value.toLowerCase().includes(query))) &&
        (categoryFilter === "ALL" || record.category === categoryFilter) &&
        (publicationFilter === "ALL" || record.publicationStatus === publicationFilter) &&
        (lifecycleFilter === "ALL" || record.lifecycleStatus === lifecycleFilter)
    );
  }, [categoryFilter, lifecycleFilter, publicationFilter, search, snapshot]);

  const selectedEvidenceSource = snapshot?.sources.find((source) => source.id === evidenceSourceId);

  const submitCatalog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = event.currentTarget;
    try {
      const response = await browserFetch("/api/internal/admin/catalog", {
        body: JSON.stringify(Object.fromEntries(new FormData(form).entries())),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      form.reset();
      setMessage("Draft product and route created with a sourced immutable audit entry.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Catalog draft creation failed safely.");
    } finally {
      setPending(false);
    }
  };

  const catalogTransition = async (
    record: AdminSnapshot["catalog"][number],
    action: "ARCHIVE" | "PUBLISH" | "REJECT" | "VERIFY"
  ) => {
    const reason = window
      .prompt(`Reason for ${action.toLowerCase()} on ${record.productName}:`)
      ?.trim();
    if (!reason) return;
    const sourceUrl = record.sourceUrl ?? selectedEvidenceSource?.canonicalUrl;
    if (!sourceUrl) {
      setError("Select a current evidence source before changing this catalog record.");
      return;
    }
    await mutateCatalog(record.routeSlug, {
      action,
      reason,
      sourceUrl,
      verificationDate: new Date().toISOString()
    });
  };

  const setRouteLifecycle = async (
    record: AdminSnapshot["catalog"][number],
    lifecycleStatus: "ACTIVE" | "CLOSED" | "PAUSED" | "RESTRICTED" | "UNAVAILABLE"
  ) => {
    const reason = window
      .prompt(`Reason for marking ${record.routeName} ${lifecycleStatus}:`)
      ?.trim();
    if (!reason) return;
    const sourceUrl = record.sourceUrl ?? selectedEvidenceSource?.canonicalUrl;
    if (!sourceUrl) {
      setError("Select a current evidence source before changing route lifecycle.");
      return;
    }
    await mutateCatalog(record.routeSlug, {
      action: "SET_LIFECYCLE",
      lifecycleStatus,
      reason,
      sourceUrl,
      verificationDate: new Date().toISOString()
    });
  };

  const mutateCatalog = async (routeSlug: string, body: Record<string, unknown>) => {
    setPending(true);
    setError(null);
    try {
      const response = await browserFetch(`/api/internal/admin/catalog/${routeSlug}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "PATCH"
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage("Catalog transition applied and audited.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Catalog transition failed safely.");
    } finally {
      setPending(false);
    }
  };

  const editCatalog = async (record: AdminSnapshot["catalog"][number]) => {
    const productName = window.prompt("Product name", record.productName)?.trim();
    const routeName = window.prompt("Route name", record.routeName)?.trim();
    const symbol = window.prompt("Symbol", record.symbol)?.trim();
    const kyc = window.prompt("KYC: yes, no, or unknown", "unknown")?.trim().toLowerCase();
    const reason = window.prompt("Reason and evidence summary:")?.trim();
    const sourceUrl = record.sourceUrl ?? selectedEvidenceSource?.canonicalUrl;
    if (!productName || !routeName || !symbol || !reason || !sourceUrl) return;
    if (!kyc || !["yes", "no", "unknown"].includes(kyc)) return;
    setPending(true);
    try {
      const response = await browserFetch(`/api/internal/admin/catalog/${record.routeSlug}`, {
        body: JSON.stringify({
          productName,
          reason,
          requiresKyc: kyc === "unknown" ? null : kyc === "yes",
          routeName,
          sourceUrl,
          symbol,
          verificationDate: new Date().toISOString()
        }),
        headers: { "content-type": "application/json" },
        method: "PUT"
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage("A superseding catalog draft version was created.");
      await refresh();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Catalog edit failed safely.");
    } finally {
      setPending(false);
    }
  };

  const resync = async (record: AdminSnapshot["catalog"][number]) => {
    const reason = window.prompt(`Reason for re-ingesting ${record.routeName}:`)?.trim();
    if (!reason) return;
    setPending(true);
    try {
      const response = await browserFetch("/api/internal/admin/resync", {
        body: JSON.stringify({ reason, routeSlug: record.routeSlug }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      setMessage("A bounded canonical-adapter re-ingestion job was queued and audited.");
      await refresh();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "Re-ingestion failed safely.");
    } finally {
      setPending(false);
    }
  };

  const submitSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const succeeded = await runAction(
      {
        action: "SOURCE_CREATE",
        attributionText: nullableText(values.get("attributionText")),
        canonicalUrl: String(values.get("canonicalUrl")),
        code: String(values.get("code")).trim().toUpperCase(),
        expectedCadenceSeconds: nullableInteger(values.get("expectedCadenceSeconds")),
        freshnessThresholdSeconds: nullableInteger(values.get("freshnessThresholdSeconds")),
        licenceName: nullableText(values.get("licenceName")),
        licenceUrl: nullableText(values.get("licenceUrl")),
        name: String(values.get("name")),
        ownerName: String(values.get("ownerName")),
        priority: Number(values.get("priority")),
        reason: String(values.get("reason")),
        removalProcedure: String(values.get("removalProcedure")),
        sourceType: String(values.get("sourceType")),
        termsUrl: nullableText(values.get("termsUrl")),
        verificationDate: verificationInstant(String(values.get("verificationDate")))
      },
      "Source draft created with version 1 and an immutable audit entry."
    );
    if (succeeded) form.reset();
  };

  const editSource = async (source: AdminSnapshot["sources"][number]) => {
    const name = window.prompt("Source name", source.name)?.trim();
    const canonicalUrl = window.prompt("Canonical HTTPS URL", source.canonicalUrl)?.trim();
    const ownerName = window.prompt("Source owner", source.ownerName)?.trim();
    const removalProcedure = window.prompt("Removal procedure", source.removalProcedure)?.trim();
    const reason = window.prompt("Reason for this new source version:")?.trim();
    if (!name || !canonicalUrl || !ownerName || !removalProcedure || !reason) return;
    await runAction(
      {
        action: "SOURCE_VERSION",
        attributionText: source.attributionText,
        canonicalUrl,
        code: source.code,
        expectedCadenceSeconds: source.expectedCadenceSeconds,
        freshnessThresholdSeconds: source.freshnessThresholdSeconds,
        id: source.id,
        licenceName: source.licenceName,
        licenceUrl: source.licenceUrl,
        name,
        ownerName,
        priority: source.priority,
        reason,
        removalProcedure,
        sourceType: source.sourceType,
        termsUrl: source.termsUrl,
        verificationDate: new Date().toISOString()
      },
      "A superseding source draft version was created; the prior version remains auditable."
    );
  };

  const transitionSource = async (
    source: AdminSnapshot["sources"][number],
    transition: "ARCHIVE" | "PUBLISH" | "REJECT" | "REVIEW"
  ) => {
    const reason = window.prompt(`Reason for source ${transition.toLowerCase()}:`)?.trim();
    if (!reason) return;
    await runAction(
      {
        action: "SOURCE_TRANSITION",
        id: source.id,
        reason,
        transition,
        verificationDate: new Date().toISOString()
      },
      `Source ${transition.toLowerCase()} transition applied and audited.`
    );
  };

  const submitEntity = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const succeeded = await runAction(
      {
        action: "ENTITY_UPSERT",
        caip2Id: entityType === "CHAIN" ? nullableText(values.get("caip2Id")) : null,
        entityType,
        explorerBaseUrl: entityType === "CHAIN" ? nullableText(values.get("officialUrl")) : null,
        finalityBlocks:
          entityType === "CHAIN" ? nullableInteger(values.get("finalityBlocks")) : null,
        id: null,
        jurisdictionIsoCode:
          entityType === "CHAIN" ? null : nullableText(values.get("jurisdictionIsoCode")),
        legalName: entityType === "CHAIN" ? null : nullableText(values.get("legalName")),
        lifecycleStatus: "ACTIVE",
        name: String(values.get("name")),
        officialUrl: entityType === "CHAIN" ? null : nullableText(values.get("officialUrl")),
        reason: String(values.get("reason")),
        sourceId: String(values.get("sourceId")),
        verificationDate: verificationInstant(String(values.get("verificationDate")))
      },
      `${entityType.toLowerCase()} metadata created with sourced revision history.`
    );
    if (succeeded) form.reset();
  };

  const editEntity = async (entity: AdminSnapshot["entities"][number]) => {
    if (!evidenceSourceId) {
      setError("Select an evidence source before editing entity metadata.");
      return;
    }
    const name = window.prompt("Entity name", entity.name)?.trim();
    const legalName =
      entity.entityType === "CHAIN"
        ? null
        : (window.prompt("Legal name (blank for unavailable)", entity.legalName ?? "")?.trim() ??
          null);
    const officialUrl = window
      .prompt(
        entity.entityType === "CHAIN" ? "Explorer URL" : "Official URL",
        entity.officialUrl ?? ""
      )
      ?.trim();
    const lifecycleStatus = window
      .prompt(
        "Lifecycle: ACTIVE, PAUSED, RESTRICTED, CLOSED, UNAVAILABLE, or ARCHIVED",
        entity.lifecycleStatus
      )
      ?.trim()
      .toUpperCase();
    const reason = window.prompt("Reason and source verification summary:")?.trim();
    if (!name || !reason || officialUrl === undefined || !lifecycleStatus) return;
    await runAction(
      {
        action: "ENTITY_UPSERT",
        caip2Id: entity.entityType === "CHAIN" ? entity.identifier : null,
        entityType: entity.entityType,
        explorerBaseUrl: entity.entityType === "CHAIN" ? officialUrl || null : null,
        finalityBlocks: entity.finalityBlocks,
        id: entity.id,
        jurisdictionIsoCode: entity.jurisdictionIsoCode,
        legalName: legalName || null,
        lifecycleStatus,
        name,
        officialUrl: entity.entityType === "CHAIN" ? null : officialUrl || null,
        reason,
        sourceId: evidenceSourceId,
        verificationDate: new Date().toISOString()
      },
      "Entity metadata revision applied; before and after snapshots were retained."
    );
  };

  const submitAccessTerms = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const eligibility =
      accessKind === "ELIGIBILITY"
        ? {
            conditionsText: nullableText(values.get("conditionsText")),
            eligibilityStatus: String(values.get("eligibilityStatus")),
            investorClassification: String(values.get("investorClassification")),
            jurisdictionIsoCode: String(values.get("jurisdictionIsoCode")).trim().toUpperCase(),
            jurisdictionName: String(values.get("jurisdictionName")),
            requiresKyc: nullableBoolean(values.get("requiresKyc"))
          }
        : null;
    const minimumAmount = nullableText(values.get("minimumAmount"));
    const redemption =
      accessKind === "REDEMPTION"
        ? {
            gatesPossible: nullableBoolean(values.get("gatesPossible")),
            inKindPossible: nullableBoolean(values.get("inKindPossible")),
            minimumAmount,
            minimumAmountAssetId:
              minimumAmount === null ? null : nullableText(values.get("minimumAmountAssetId")),
            noticePeriodHours: nullableText(values.get("noticePeriodHours")),
            settlementPeriodHours: nullableText(values.get("settlementPeriodHours")),
            windowDescription: nullableText(values.get("windowDescription"))
          }
        : null;
    const succeeded = await runAction(
      {
        action: "ACCESS_TERMS_VERSION",
        eligibility,
        reason: String(values.get("reason")),
        redemption,
        routeId: String(values.get("routeId")),
        sourceId: String(values.get("sourceId")),
        sourceLinkUrl:
          accessKind === "SOURCE_LINK" ? nullableText(values.get("sourceLinkUrl")) : null,
        verificationDate: verificationInstant(String(values.get("verificationDate")))
      },
      "A sourced access/redemption draft version was appended without overwriting prior evidence."
    );
    if (succeeded) form.reset();
  };

  const transitionAccessTerm = async (
    term: AdminSnapshot["accessTerms"][number],
    transition: "ARCHIVE" | "PUBLISH" | "REJECT" | "REVIEW"
  ) => {
    const reason = window.prompt(`Reason for ${transition.toLowerCase()} on ${term.type}:`)?.trim();
    if (!reason) return;
    await runAction(
      {
        action: "ACCESS_TERMS_TRANSITION",
        id: term.id,
        reason,
        recordType: term.type,
        sourceId: term.sourceId,
        transition,
        verificationDate: new Date().toISOString()
      },
      `${term.type.toLowerCase()} ${transition.toLowerCase()} transition applied and audited.`
    );
  };

  const reviewObservation = async (observation: AdminSnapshot["observations"][number]) => {
    const assessment = window
      .prompt("Assessment: STALE, INCORRECT, CONFLICT, or NOTE", "NOTE")
      ?.trim()
      .toUpperCase();
    const annotation = window.prompt("Reviewer annotation:")?.trim();
    const override = window
      .prompt(
        "Optional override status: STALE, REJECTED, CONFLICTED, UNAVAILABLE; blank for none",
        ""
      )
      ?.trim()
      .toUpperCase();
    const reason = window.prompt("Reason for annotation/override:")?.trim();
    if (!assessment || !annotation || !reason) return;
    await runAction(
      {
        action: "OBSERVATION_REVIEW",
        annotation,
        assessment,
        observationId: observation.id,
        overrideStatus: override || null,
        reason,
        verificationDate: new Date().toISOString()
      },
      "Observation annotation was appended; the original observation was not altered."
    );
  };

  const resolveQualityEvent = async (event: AdminSnapshot["qualityEvents"][number]) => {
    const resolution = window.prompt("Resolution annotation:")?.trim();
    const reason = window.prompt("Reason and verification evidence:")?.trim();
    if (!resolution || !reason) return;
    await runAction(
      {
        action: "QUALITY_RESOLVE",
        id: event.id,
        reason,
        resolution,
        verificationDate: new Date().toISOString()
      },
      "Quality event resolved with attributable history retained."
    );
  };

  const submitMethodology = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    let weights: unknown;
    try {
      weights = JSON.parse(String(values.get("weights")));
    } catch {
      setError("Methodology weights must be valid JSON.");
      return;
    }
    const succeeded = await runAction(
      {
        action: "METHODOLOGY_SAVE",
        calculationVersion: String(values.get("calculationVersion")),
        configuration: {
          maxAnnualPenaltyPp: String(values.get("maxAnnualPenaltyPp")),
          minimumEvidenceCoveragePct: String(values.get("minimumEvidenceCoveragePct")),
          unknownRiskProxy: String(values.get("unknownRiskProxy"))
        },
        description: String(values.get("description")),
        effectiveFrom: verificationInstant(String(values.get("effectiveFrom"))),
        id: null,
        reason: String(values.get("reason")),
        verificationDate: verificationInstant(String(values.get("verificationDate"))),
        version: String(values.get("version")),
        weights
      },
      "Methodology draft saved with exact per-category 100% weight validation."
    );
    if (succeeded) form.reset();
  };

  const editMethodology = async (methodology: AdminSnapshot["methodologies"][number]) => {
    const description = window.prompt("Methodology description", methodology.description)?.trim();
    const reason = window.prompt("Reason for editing this draft:")?.trim();
    if (!description || !reason) return;
    const configurationSchema = z
      .object({
        maxAnnualPenaltyPp: z.string(),
        minimumEvidenceCoveragePct: z.string(),
        unknownRiskProxy: z.string()
      })
      .passthrough();
    const configuration = configurationSchema.safeParse(methodology.configuration);
    if (!configuration.success) {
      setError("The existing draft configuration is incomplete and cannot be edited safely.");
      return;
    }
    await runAction(
      {
        action: "METHODOLOGY_SAVE",
        calculationVersion: methodology.calculationVersion,
        configuration: {
          maxAnnualPenaltyPp: configuration.data.maxAnnualPenaltyPp,
          minimumEvidenceCoveragePct: configuration.data.minimumEvidenceCoveragePct,
          unknownRiskProxy: configuration.data.unknownRiskProxy
        },
        description,
        effectiveFrom: methodology.effectiveFrom,
        id: methodology.id,
        reason,
        verificationDate: new Date().toISOString(),
        version: methodology.version,
        weights: methodology.weights
      },
      "Methodology draft updated; published versions remain immutable."
    );
  };

  const transitionMethodology = async (
    methodology: AdminSnapshot["methodologies"][number],
    transition: "PUBLISH" | "REJECT" | "REVIEW"
  ) => {
    const reason = window.prompt(`Reason for methodology ${transition.toLowerCase()}:`)?.trim();
    if (!reason) return;
    await runAction(
      {
        action: "METHODOLOGY_TRANSITION",
        id: methodology.id,
        reason,
        transition,
        verificationDate: new Date().toISOString()
      },
      `Methodology ${transition.toLowerCase()} transition applied and audited.`
    );
  };

  const exportQuality = async () => {
    const reason = window.prompt("Reason for exporting the data-quality report:")?.trim();
    if (!reason) return;
    setPending(true);
    try {
      const response = await browserFetch("/api/internal/admin/export", {
        body: JSON.stringify({ reason, report: "DATA_QUALITY" }),
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `rwa-data-quality-${today()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage(
        "CSV-safe data-quality report generated from the authoritative database snapshot."
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Data-quality export failed safely.");
    } finally {
      setPending(false);
    }
  };

  const loadSecurityAudit = async () => {
    setPending(true);
    try {
      const response = await browserFetch("/api/internal/admin/security", {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const parsed = securitySnapshotSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error("Security audit response failed schema validation.");
      setSecurityEvents(parsed.data.data);
      setMessage("Security audit loaded under the SECURITY_ADMIN capability boundary.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Security audit is restricted to security administrators."
      );
    } finally {
      setPending(false);
    }
  };

  if (loading && snapshot === null)
    return (
      <div aria-live="polite" className="data-state">
        <span className="eyebrow">Authoritative database</span>
        <h2>Loading operations console</h2>
        <p>Catalog, provenance, job, alert, methodology, and audit records are being authorized.</p>
      </div>
    );

  if (snapshot === null)
    return (
      <div className="data-state" role="alert">
        <span className="eyebrow">Fail-closed administration</span>
        <h2>Operations data is unavailable</h2>
        <p>{error ?? "The database snapshot could not be authorized."}</p>
        <button className="button button-primary" onClick={() => void refresh()} type="button">
          Retry
        </button>
      </div>
    );

  const publishedRoutes = snapshot.catalog.filter(
    (record) => record.publicationStatus === "PUBLISHED"
  ).length;
  const reviewQueue = snapshot.catalog.filter((record) =>
    ["DRAFT", "REVIEWED"].includes(record.publicationStatus)
  ).length;
  const openQuality = snapshot.qualityEvents.filter((event) => event.resolvedAt === null).length;
  const failedJobs = snapshot.jobs.filter((job) =>
    ["FAILED", "DEAD_LETTERED"].includes(job.status)
  ).length;
  const evidenceSources = snapshot.sources.filter(
    (source) =>
      source.status !== "REMOVED" &&
      (source.publicationStatus === "REVIEWED" || source.publicationStatus === "PUBLISHED")
  );

  return (
    <>
      <div className="metric-grid">
        <Metric
          detail="Current authoritative route rows"
          label="Published routes"
          value={publishedRoutes}
        />
        <Metric
          detail="Draft or reviewed current routes"
          label="Review queue"
          value={reviewQueue}
        />
        <Metric
          detail="Unresolved annotations and overrides"
          label="Quality events"
          value={openQuality}
        />
        <Metric detail="Latest bounded operational window" label="Failed jobs" value={failedJobs} />
      </div>

      <div
        aria-live="polite"
        className={error ? "legal-strip" : "faint"}
        role={error ? "alert" : undefined}
      >
        {error ?? message ?? `Authoritative snapshot generated ${snapshot.generatedAt}.`}
      </div>

      <section className="section panel">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Evidence context</span>
            <h2>Source for quick metadata actions</h2>
            <p>Entity and unsourced catalog actions require an explicit current source.</p>
          </div>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => void refresh()}
            type="button"
          >
            <RefreshCcw aria-hidden size={14} /> Refresh
          </button>
        </div>
        <label className="field">
          <span>Evidence source</span>
          <select
            className="select"
            onChange={(event) => setEvidenceSourceId(event.target.value)}
            value={evidenceSourceId}
          >
            <option value="">Select a source</option>
            {evidenceSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.code} v{source.version} · {source.publicationStatus}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Current catalog</span>
            <h2>Review, publication, lifecycle, and re-ingestion</h2>
            <p>Filters operate on current DB versions; gated discovery evidence remains visible.</p>
          </div>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => void exportQuality()}
            type="button"
          >
            <Download aria-hidden size={14} /> Export data-quality CSV
          </button>
        </div>
        <div className="filters">
          <label className="field">
            <span>Search</span>
            <input
              className="input"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Product, route, issuer, protocol"
              value={search}
            />
          </label>
          <label className="field">
            <span>Category</span>
            <select
              className="select"
              onChange={(event) => setCategoryFilter(event.target.value)}
              value={categoryFilter}
            >
              <option value="ALL">All categories</option>
              {CATEGORY_VALUES.map((category) => (
                <option key={category} value={category}>
                  {CATEGORY_META[category].shortLabel}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Publication</span>
            <select
              className="select"
              onChange={(event) => setPublicationFilter(event.target.value)}
              value={publicationFilter}
            >
              <option value="ALL">All states</option>
              {["DRAFT", "REVIEWED", "PUBLISHED", "REJECTED", "ARCHIVED", "SUPERSEDED"].map(
                (status) => (
                  <option key={status}>{status}</option>
                )
              )}
            </select>
          </label>
          <label className="field">
            <span>Lifecycle</span>
            <select
              className="select"
              onChange={(event) => setLifecycleFilter(event.target.value)}
              value={lifecycleFilter}
            >
              <option value="ALL">All states</option>
              {lifecycleStatusValues.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Product / route</th>
                <th scope="col">Evidence</th>
                <th scope="col">State</th>
                <th scope="col">Terms</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCatalog.map((record) => (
                <tr key={record.routeId}>
                  <td>
                    <strong>{record.productName}</strong>
                    <br />
                    <span className="faint">
                      {record.routeName} · {record.symbol} · v{record.routeVersion}
                    </span>
                  </td>
                  <td>
                    {record.sourceUrl ? (
                      <a
                        className="source-link"
                        href={record.sourceUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {record.sourceName}
                      </a>
                    ) : (
                      "Source link pending"
                    )}
                    <br />
                    <span className="faint">
                      {record.discoveryStatus ?? "Manual draft"} ·{" "}
                      {record.verifiedAt ?? "unverified"}
                    </span>
                  </td>
                  <td>
                    {record.publicationStatus}
                    <br />
                    <span className="faint">{record.lifecycleStatus}</span>
                  </td>
                  <td>
                    <span className="faint">
                      {record.eligibilitySummary ?? "Versioned terms pending"}
                      <br />
                      {record.redemptionSummary ?? "Redemption pending"}
                    </span>
                  </td>
                  <td>
                    <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void editCatalog(record)}
                        type="button"
                      >
                        <Pencil aria-hidden size={12} /> Edit
                      </button>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void catalogTransition(record, "VERIFY")}
                        type="button"
                      >
                        Verify
                      </button>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void catalogTransition(record, "PUBLISH")}
                        type="button"
                      >
                        Publish
                      </button>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void catalogTransition(record, "REJECT")}
                        type="button"
                      >
                        Reject
                      </button>
                      <select
                        aria-label={`Lifecycle for ${record.routeName}`}
                        className="select"
                        disabled={pending}
                        onChange={(event) => {
                          const value = event.target.value as
                            "ACTIVE" | "CLOSED" | "PAUSED" | "RESTRICTED" | "UNAVAILABLE";
                          if (value !== record.lifecycleStatus)
                            void setRouteLifecycle(record, value);
                        }}
                        value={
                          record.lifecycleStatus === "ARCHIVED"
                            ? "UNAVAILABLE"
                            : record.lifecycleStatus
                        }
                      >
                        {["ACTIVE", "PAUSED", "RESTRICTED", "CLOSED", "UNAVAILABLE"].map(
                          (status) => (
                            <option key={status}>{status}</option>
                          )
                        )}
                      </select>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending || record.protocol !== "Morpho"}
                        onClick={() => void resync(record)}
                        type="button"
                      >
                        <RefreshCcw aria-hidden size={12} /> Re-ingest
                      </button>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void catalogTransition(record, "ARCHIVE")}
                        type="button"
                      >
                        <Archive aria-hidden size={12} /> Archive
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <details className="section panel">
        <summary>
          <strong>Create a sourced product and initial route</strong>
        </summary>
        <form onSubmit={submitCatalog} style={{ marginTop: 18 }}>
          <div className="form-grid">
            <label className="field">
              <span>Product name</span>
              <input className="input" name="productName" required />
            </label>
            <label className="field">
              <span>Symbol</span>
              <input className="input" maxLength={32} name="symbol" required />
            </label>
            <label className="field">
              <span>Category</span>
              <select className="select" name="category">
                {CATEGORY_VALUES.map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Issuer</span>
              <input className="input" name="issuer" required />
            </label>
            <label className="field">
              <span>Underlying asset</span>
              <input className="input" name="underlyingAsset" required />
            </label>
            <label className="field">
              <span>Route name</span>
              <input className="input" name="routeName" required />
            </label>
            <label className="field">
              <span>Chain</span>
              <input className="input" name="chain" required />
            </label>
            <label className="field">
              <span>CAIP-2 id</span>
              <input className="input mono" name="caip2Id" placeholder="eip155:1" required />
            </label>
            <label className="field">
              <span>Access method</span>
              <select className="select" name="accessMethod">
                {[
                  "ISSUER_MINT",
                  "ISSUER_REDEMPTION",
                  "DEX_PURCHASE",
                  "LENDING_DEPOSIT",
                  "VAULT_DEPOSIT",
                  "NATIVE_HOLD"
                ].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Canonical source URL</span>
              <input className="input" name="sourceUrl" pattern="https://.*" required type="url" />
            </label>
            <label className="field">
              <span>Verification date</span>
              <input
                className="input"
                defaultValue={today()}
                name="verificationDate"
                required
                type="date"
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span>Reason and verification note</span>
            <textarea className="textarea" name="reason" required />
          </label>
          <button
            className="button button-primary"
            disabled={pending}
            style={{ marginTop: 14 }}
            type="submit"
          >
            <Plus aria-hidden size={14} /> Create draft
          </button>
        </form>
      </details>

      <section className="section grid grid-2">
        <details className="panel">
          <summary>
            <strong>Source registry workflow</strong>
          </summary>
          <form onSubmit={submitSource} style={{ marginTop: 18 }}>
            <div className="form-grid">
              <label className="field">
                <span>Code</span>
                <input className="input" name="code" pattern="[A-Za-z0-9_-]+" required />
              </label>
              <label className="field">
                <span>Name</span>
                <input className="input" name="name" required />
              </label>
              <label className="field">
                <span>Type</span>
                <select className="select" name="sourceType">
                  {sourceTypeValues.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Owner</span>
                <input className="input" name="ownerName" required />
              </label>
              <label className="field">
                <span>Canonical URL</span>
                <input
                  className="input"
                  name="canonicalUrl"
                  pattern="https://.*"
                  required
                  type="url"
                />
              </label>
              <label className="field">
                <span>Terms URL</span>
                <input className="input" name="termsUrl" pattern="https://.*" type="url" />
              </label>
              <label className="field">
                <span>Licence</span>
                <input className="input" name="licenceName" />
              </label>
              <label className="field">
                <span>Licence URL</span>
                <input className="input" name="licenceUrl" pattern="https://.*" type="url" />
              </label>
              <label className="field">
                <span>Cadence seconds</span>
                <input className="input" min={1} name="expectedCadenceSeconds" type="number" />
              </label>
              <label className="field">
                <span>Freshness seconds</span>
                <input className="input" min={1} name="freshnessThresholdSeconds" type="number" />
              </label>
              <label className="field">
                <span>Priority</span>
                <input
                  className="input"
                  defaultValue="100"
                  min={0}
                  name="priority"
                  required
                  type="number"
                />
              </label>
              <label className="field">
                <span>Verification date</span>
                <input
                  className="input"
                  defaultValue={today()}
                  name="verificationDate"
                  required
                  type="date"
                />
              </label>
            </div>
            <label className="field">
              <span>Attribution</span>
              <input className="input" name="attributionText" />
            </label>
            <label className="field">
              <span>Removal procedure</span>
              <textarea className="textarea" name="removalProcedure" required />
            </label>
            <label className="field">
              <span>Reason</span>
              <textarea className="textarea" name="reason" required />
            </label>
            <button className="button button-primary" disabled={pending} type="submit">
              <Plus aria-hidden size={14} /> Create source draft
            </button>
          </form>
        </details>
        <details className="panel">
          <summary>
            <strong>Issuer, protocol, chain, and custodian metadata</strong>
          </summary>
          <form onSubmit={submitEntity} style={{ marginTop: 18 }}>
            <div className="form-grid">
              <label className="field">
                <span>Entity type</span>
                <select
                  className="select"
                  onChange={(event) => setEntityType(event.target.value as typeof entityType)}
                  value={entityType}
                >
                  {["ISSUER", "PROTOCOL", "CHAIN", "CUSTODIAN"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Name</span>
                <input className="input" name="name" required />
              </label>
              {entityType === "CHAIN" ? (
                <>
                  <label className="field">
                    <span>CAIP-2 id</span>
                    <input className="input" name="caip2Id" placeholder="eip155:1" required />
                  </label>
                  <label className="field">
                    <span>Finality blocks</span>
                    <input className="input" min={0} name="finalityBlocks" type="number" />
                  </label>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Legal name</span>
                    <input className="input" name="legalName" />
                  </label>
                  <label className="field">
                    <span>Jurisdiction ISO (must exist)</span>
                    <input className="input" maxLength={3} name="jurisdictionIsoCode" />
                  </label>
                </>
              )}
              <label className="field">
                <span>{entityType === "CHAIN" ? "Explorer" : "Official"} URL</span>
                <input className="input" name="officialUrl" pattern="https://.*" type="url" />
              </label>
              <label className="field">
                <span>Evidence source</span>
                <select className="select" name="sourceId" required>
                  {evidenceSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.code} v{source.version}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Verification date</span>
                <input
                  className="input"
                  defaultValue={today()}
                  name="verificationDate"
                  required
                  type="date"
                />
              </label>
            </div>
            <label className="field">
              <span>Reason</span>
              <textarea className="textarea" name="reason" required />
            </label>
            <button className="button button-primary" disabled={pending} type="submit">
              <Plus aria-hidden size={14} /> Add entity metadata
            </button>
          </form>
        </details>
      </section>

      <details className="section panel">
        <summary>
          <strong>Current sources and entity metadata</strong>
        </summary>
        <div className="grid grid-2" style={{ marginTop: 18 }}>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">State</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.sources.map((source) => (
                  <tr key={source.id}>
                    <td>
                      <a
                        className="source-link"
                        href={source.canonicalUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {source.code} v{source.version}
                      </a>
                      <br />
                      <span className="faint">{source.name}</span>
                    </td>
                    <td>
                      {source.publicationStatus}
                      <br />
                      <span className="faint">{source.status}</span>
                    </td>
                    <td>
                      <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                        <button
                          className="button button-secondary button-small"
                          disabled={pending}
                          onClick={() => void editSource(source)}
                          type="button"
                        >
                          Edit version
                        </button>
                        {(["REVIEW", "PUBLISH", "REJECT", "ARCHIVE"] as const).map((action) => (
                          <button
                            className="button button-secondary button-small"
                            disabled={pending}
                            key={action}
                            onClick={() => void transitionSource(source, action)}
                            type="button"
                          >
                            {action}
                          </button>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Entity</th>
                  <th scope="col">State</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.entities.map((entity) => (
                  <tr key={`${entity.entityType}:${entity.id}`}>
                    <td>
                      <strong>{entity.name}</strong>
                      <br />
                      <span className="faint">
                        {entity.entityType} · {entity.identifier ?? "identifier unavailable"}
                      </span>
                    </td>
                    <td>{entity.lifecycleStatus}</td>
                    <td>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void editEntity(entity)}
                        type="button"
                      >
                        <Pencil aria-hidden size={12} /> Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className="section panel">
        <summary>
          <strong>Eligibility, redemption, and official source links</strong>
        </summary>
        <form onSubmit={submitAccessTerms} style={{ marginTop: 18 }}>
          <div className="form-grid">
            <label className="field">
              <span>Term type</span>
              <select
                className="select"
                onChange={(event) => setAccessKind(event.target.value as typeof accessKind)}
                value={accessKind}
              >
                {["ELIGIBILITY", "REDEMPTION", "SOURCE_LINK"].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Route</span>
              <select className="select" name="routeId" required>
                {snapshot.catalog.map((record) => (
                  <option key={record.routeId} value={record.routeId}>
                    {record.productName} · {record.routeName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Source</span>
              <select className="select" name="sourceId" required>
                {evidenceSources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.code} v{source.version}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Verification date</span>
              <input
                className="input"
                defaultValue={today()}
                name="verificationDate"
                required
                type="date"
              />
            </label>
            {accessKind === "ELIGIBILITY" ? (
              <>
                <label className="field">
                  <span>Jurisdiction ISO</span>
                  <input
                    className="input"
                    defaultValue="USA"
                    maxLength={3}
                    name="jurisdictionIsoCode"
                    required
                  />
                </label>
                <label className="field">
                  <span>Jurisdiction name</span>
                  <input
                    className="input"
                    defaultValue="United States"
                    name="jurisdictionName"
                    required
                  />
                </label>
                <label className="field">
                  <span>Investor class</span>
                  <select className="select" name="investorClassification">
                    {investorClassificationValues.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Eligibility</span>
                  <select className="select" name="eligibilityStatus">
                    {["ELIGIBLE", "INELIGIBLE", "CONDITIONAL", "UNKNOWN"].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>KYC</span>
                  <select className="select" name="requiresKyc">
                    <option value="unknown">Unknown</option>
                    <option value="true">Required</option>
                    <option value="false">Not required</option>
                  </select>
                </label>
                <label className="field">
                  <span>Conditions</span>
                  <textarea className="textarea" name="conditionsText" />
                </label>
              </>
            ) : null}
            {accessKind === "REDEMPTION" ? (
              <>
                <label className="field">
                  <span>Window description</span>
                  <textarea className="textarea" name="windowDescription" />
                </label>
                <label className="field">
                  <span>Notice hours</span>
                  <input
                    className="input"
                    min={0}
                    name="noticePeriodHours"
                    step="any"
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>Settlement hours</span>
                  <input
                    className="input"
                    min={0}
                    name="settlementPeriodHours"
                    step="any"
                    type="number"
                  />
                </label>
                <label className="field">
                  <span>Minimum amount</span>
                  <input className="input" min={0} name="minimumAmount" step="any" type="number" />
                </label>
                <label className="field">
                  <span>Minimum asset</span>
                  <select className="select" name="minimumAmountAssetId">
                    <option value="">Unavailable</option>
                    {snapshot.assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.symbol} · {asset.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Gates possible</span>
                  <select className="select" name="gatesPossible">
                    <option value="unknown">Unknown</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
                <label className="field">
                  <span>In-kind possible</span>
                  <select className="select" name="inKindPossible">
                    <option value="unknown">Unknown</option>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </select>
                </label>
              </>
            ) : null}
            {accessKind === "SOURCE_LINK" ? (
              <label className="field">
                <span>Official source link</span>
                <input
                  className="input"
                  name="sourceLinkUrl"
                  pattern="https://.*"
                  required
                  type="url"
                />
              </label>
            ) : null}
          </div>
          <label className="field">
            <span>Reason and evidence note</span>
            <textarea className="textarea" name="reason" required />
          </label>
          <button className="button button-primary" disabled={pending} type="submit">
            <Plus aria-hidden size={14} /> Append draft version
          </button>
        </form>
        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Type</th>
                <th scope="col">Detail</th>
                <th scope="col">Source</th>
                <th scope="col">State</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.accessTerms.map((term) => (
                <tr key={term.id}>
                  <td>
                    {term.type} v{term.version}
                  </td>
                  <td>{term.detail || "Explicitly unavailable"}</td>
                  <td>{term.sourceName}</td>
                  <td>
                    {term.publicationStatus}
                    <br />
                    <span className="faint">{term.verifiedAt ?? "unverified"}</span>
                  </td>
                  <td>
                    <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                      {(["REVIEW", "PUBLISH", "REJECT", "ARCHIVE"] as const).map((action) => (
                        <button
                          className="button button-secondary button-small"
                          disabled={pending}
                          key={action}
                          onClick={() => void transitionAccessTerm(term, action)}
                          type="button"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="section grid grid-2">
        <details className="panel" open>
          <summary>
            <strong>Observation review and non-destructive override</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Value</th>
                  <th scope="col">Evidence</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.observations.map((observation) => (
                  <tr key={observation.id}>
                    <td>
                      {observation.metric}
                      <br />
                      <span className="faint">
                        {observation.status} · {observation.confidence}
                      </span>
                    </td>
                    <td>
                      {observation.normalizedValue ?? "Unavailable"} {observation.unit}
                    </td>
                    <td>
                      {observation.sourceName}
                      <br />
                      <span className="faint">{observation.observedAt}</span>
                    </td>
                    <td>
                      <button
                        className="button button-secondary button-small"
                        disabled={pending}
                        onClick={() => void reviewObservation(observation)}
                        type="button"
                      >
                        Annotate / override
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="panel" open>
          <summary>
            <strong>Data-quality events</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: 18 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Event</th>
                  <th scope="col">Detected</th>
                  <th scope="col">State</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.qualityEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      {event.eventType}
                      <br />
                      <span className="faint">
                        {event.metric ?? event.entityType} · {event.severity}
                      </span>
                    </td>
                    <td>{event.detectedAt}</td>
                    <td>{event.resolvedAt === null ? "OPEN" : `RESOLVED · ${event.resolution}`}</td>
                    <td>
                      {event.resolvedAt === null ? (
                        <button
                          className="button button-secondary button-small"
                          disabled={pending}
                          onClick={() => void resolveQualityEvent(event)}
                          type="button"
                        >
                          Resolve
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <details className="section panel">
        <summary>
          <strong>Versioned risk methodology governance</strong>
        </summary>
        <p>
          Every category must contain all {RISK_FACTORS.length} factors and total exactly 100%. A
          reviewer cannot publish their own review.
        </p>
        <form onSubmit={submitMethodology}>
          <div className="form-grid">
            <label className="field">
              <span>Semantic version</span>
              <input className="input" defaultValue="1.0.1" name="version" required />
            </label>
            <label className="field">
              <span>Calculation version</span>
              <input
                className="input"
                defaultValue="risk-engine-v1.0.1"
                name="calculationVersion"
                required
              />
            </label>
            <label className="field">
              <span>Unknown risk proxy</span>
              <input className="input" defaultValue="75" name="unknownRiskProxy" required />
            </label>
            <label className="field">
              <span>Minimum evidence %</span>
              <input
                className="input"
                defaultValue="70"
                name="minimumEvidenceCoveragePct"
                required
              />
            </label>
            <label className="field">
              <span>Maximum annual penalty pp</span>
              <input className="input" defaultValue="12" name="maxAnnualPenaltyPp" required />
            </label>
            <label className="field">
              <span>Effective from</span>
              <input
                className="input"
                defaultValue={today()}
                name="effectiveFrom"
                required
                type="date"
              />
            </label>
            <label className="field">
              <span>Verification date</span>
              <input
                className="input"
                defaultValue={today()}
                name="verificationDate"
                required
                type="date"
              />
            </label>
          </div>
          <label className="field">
            <span>Description</span>
            <textarea className="textarea" name="description" required />
          </label>
          <label className="field">
            <span>Category weights JSON</span>
            <textarea
              className="textarea mono"
              defaultValue={JSON.stringify(defaultWeights, null, 2)}
              name="weights"
              required
              rows={18}
            />
          </label>
          <label className="field">
            <span>Reason</span>
            <textarea className="textarea" name="reason" required />
          </label>
          <button className="button button-primary" disabled={pending} type="submit">
            <Plus aria-hidden size={14} /> Save draft
          </button>
        </form>
        <div className="table-wrap" style={{ marginTop: 20 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Version</th>
                <th scope="col">State</th>
                <th scope="col">Weights</th>
                <th scope="col">Governance</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.methodologies.map((methodology) => (
                <tr key={methodology.id}>
                  <td>
                    <strong>{methodology.version}</strong>
                    <br />
                    <span className="faint">{methodology.calculationVersion}</span>
                  </td>
                  <td>
                    {methodology.publicationStatus}
                    <br />
                    <span className="faint">Effective {methodology.effectiveFrom}</span>
                  </td>
                  <td>
                    {methodology.weights.length}/{CATEGORY_VALUES.length * RISK_FACTORS.length}
                  </td>
                  <td>
                    <span className="faint">
                      Reviewed {methodology.reviewedAt ?? "pending"}
                      <br />
                      Published {methodology.publishedAt ?? "pending"}
                    </span>
                  </td>
                  <td>
                    <div className="inline-actions" style={{ flexWrap: "wrap" }}>
                      {methodology.publicationStatus === "DRAFT" ? (
                        <button
                          className="button button-secondary button-small"
                          disabled={pending}
                          onClick={() => void editMethodology(methodology)}
                          type="button"
                        >
                          <Pencil aria-hidden size={12} /> Edit
                        </button>
                      ) : null}
                      {(["REVIEW", "PUBLISH", "REJECT"] as const).map((action) => (
                        <button
                          className="button button-secondary button-small"
                          disabled={pending}
                          key={action}
                          onClick={() => void transitionMethodology(methodology, action)}
                          type="button"
                        >
                          {action}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <section className="section grid grid-3">
        <details className="panel" open>
          <summary>
            <strong>Adapter health</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Counts</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.adapterHealth.map((health) => (
                  <tr key={health.id}>
                    <td>
                      {health.sourceName}
                      <br />
                      <span className="faint">
                        {health.adapterVersion} · {health.attemptedAt}
                      </span>
                    </td>
                    <td>
                      {health.outcome}
                      <br />
                      <span className="faint">{health.errorCategory ?? "no error"}</span>
                    </td>
                    <td>
                      {health.recordsAccepted} accepted · {health.recordsRejected} rejected
                      <br />
                      <span className="faint">
                        {health.retryCount} retries · {health.deadLetterCount} DLQ ·{" "}
                        {health.staleRecordCount} stale
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="panel" open>
          <summary>
            <strong>Job failures and retries</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Job</th>
                  <th scope="col">State</th>
                  <th scope="col">Correlation</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      {job.jobName}
                      <br />
                      <span className="faint">
                        {job.sourceName ?? "system"} · attempt {job.attempt}
                      </span>
                    </td>
                    <td>
                      {job.status}
                      <br />
                      <span className="faint">
                        {job.errorCategory ?? "no error"} · DLQ {job.deadLetterCount}
                      </span>
                    </td>
                    <td className="mono">{job.correlationId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details className="panel" open>
          <summary>
            <strong>Alert delivery review</strong>
          </summary>
          <div className="table-wrap" style={{ marginTop: 14 }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">State</th>
                  <th scope="col">Attempts</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.deliveries.map((delivery) => (
                  <tr key={delivery.id}>
                    <td>{delivery.channel}</td>
                    <td>
                      {delivery.status}
                      <br />
                      <span className="faint">
                        {delivery.errorCategory ?? delivery.deliveredAt ?? "pending"}
                      </span>
                    </td>
                    <td>{delivery.attemptCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <details className="section panel">
        <summary>
          <strong>Administrative and security audit</strong>
        </summary>
        <div className="section-heading" style={{ marginTop: 18 }}>
          <p>
            Security events require the separate SECURITY_ADMIN capability and never expose subject
            or network hashes here.
          </p>
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => void loadSecurityAudit()}
            type="button"
          >
            <ShieldCheck aria-hidden size={14} /> Load security audit
          </button>
        </div>
        <div className="grid grid-2">
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Admin action</th>
                  <th scope="col">Target</th>
                  <th scope="col">Reason / evidence</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.audits.map((audit) => (
                  <tr key={audit.id}>
                    <td>
                      {audit.action}
                      <br />
                      <span className="faint">
                        {audit.occurredAt} · {audit.outcome}
                      </span>
                    </td>
                    <td>
                      {audit.targetType} v{audit.targetRecordVersion}
                      <br />
                      <span className="faint mono">{audit.correlationId}</span>
                    </td>
                    <td>
                      {audit.reason}
                      <br />
                      <span className="faint">
                        Verified {audit.verificationDate ?? "not supplied"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Security event</th>
                  <th scope="col">Outcome</th>
                  <th scope="col">Retention</th>
                </tr>
              </thead>
              <tbody>
                {securityEvents === null ? (
                  <tr>
                    <td colSpan={3}>Restricted snapshot not loaded.</td>
                  </tr>
                ) : (
                  securityEvents.map((event) => (
                    <tr key={event.id}>
                      <td>
                        {event.eventType}
                        <br />
                        <span className="faint mono">{event.correlationId}</span>
                      </td>
                      <td>
                        {event.outcome}
                        <br />
                        <span className="faint">{event.occurredAt}</span>
                      </td>
                      <td>{event.expiresAt}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </>
  );
}
