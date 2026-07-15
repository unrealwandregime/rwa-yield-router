import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";

import {
  ACCESS_METHODS,
  CONFIDENCE_CLASSIFICATIONS,
  DATA_STATUSES,
  ELIGIBILITY_STATUSES,
  INVESTOR_CLASSIFICATIONS,
  LIFECYCLE_STATUSES,
  PRODUCT_CATEGORIES,
  YIELD_SOURCE_CLASSES,
  decimalStringSchema,
  durationSchema,
  financialQuantitySchema,
  metricHasValue,
  metricValueSchema,
  normalizeDecimal,
  productSchema,
  routeSchema,
  utcTimestampSchema
} from "../src/index.js";

const ID = "10000000-0000-4000-8000-000000000001";

describe("canonical domain enums", () => {
  it("contains every published category and yield-source class", () => {
    expect(PRODUCT_CATEGORIES).toHaveLength(6);
    expect(YIELD_SOURCE_CLASSES).toHaveLength(10);
    expect(new Set(PRODUCT_CATEGORIES).size).toBe(PRODUCT_CATEGORIES.length);
    expect(new Set(YIELD_SOURCE_CLASSES).size).toBe(YIELD_SOURCE_CLASSES.length);
  });

  it("keeps confidence, lifecycle, eligibility, status, investor, and access vocabularies exhaustive", () => {
    expect(CONFIDENCE_CLASSIFICATIONS).toEqual([
      "VERIFIED_OFFICIAL",
      "DIRECT_API",
      "ONCHAIN_DERIVED",
      "ISSUER_REPORTED",
      "THIRD_PARTY",
      "MANUALLY_VERIFIED",
      "ESTIMATED",
      "STALE",
      "UNAVAILABLE"
    ]);
    expect(DATA_STATUSES).toContain("AWAITING_VERIFICATION");
    expect(LIFECYCLE_STATUSES).toContain("PAUSED");
    expect(ELIGIBILITY_STATUSES).toContain("UNKNOWN");
    expect(INVESTOR_CLASSIFICATIONS).toContain("INSTITUTIONAL");
    expect(ACCESS_METHODS).toContain("LENDING_DEPOSIT");
  });
});

describe("decimal and unit invariants", () => {
  it.each([
    ["1.2300", "1.23"],
    ["-0.000", "0"],
    ["9007199254740993.00000001", "9007199254740993.00000001"]
  ])("normalizes %s without binary floating point", (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
    expect(decimalStringSchema.parse(input)).toBe(expected);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e-8", ".25", "01.2", " 1.2", "0.1+0.2"])(
    "rejects non-canonical authoritative value %s",
    (value) => {
      expect(decimalStringSchema.safeParse(value).success).toBe(false);
    }
  );

  it("does not acquire a binary-float artifact", () => {
    const sum = new Decimal(decimalStringSchema.parse("0.1")).plus(
      decimalStringSchema.parse("0.2")
    );
    expect(sum.toString()).toBe("0.3");
  });

  it("rejects invalid amount/rate/duration unit combinations", () => {
    expect(financialQuantitySchema.safeParse({ value: "5", unit: "FIAT_AMOUNT" }).success).toBe(
      false
    );
    expect(
      financialQuantitySchema.safeParse({
        value: "5",
        unit: "PERCENTAGE_POINTS_APY",
        currency: "USD"
      }).success
    ).toBe(false);
    expect(durationSchema.safeParse({ value: "0", unit: "DAYS" }).success).toBe(false);
    expect(durationSchema.safeParse({ value: "-1", unit: "YEARS" }).success).toBe(false);
  });

  it("requires UTC rather than merely an offset timestamp", () => {
    expect(utcTimestampSchema.safeParse("2026-07-13T00:00:00Z").success).toBe(true);
    expect(utcTimestampSchema.safeParse("2026-07-13T05:30:00+05:30").success).toBe(false);
  });
});

describe("financial data states", () => {
  it("keeps observed zero distinct from unknown, unavailable, stale, estimated, and awaiting verification", () => {
    const zero = metricValueSchema.parse({ status: "CURRENT", value: "0" });
    const unknown = metricValueSchema.parse({ status: "UNKNOWN" });
    const unavailable = metricValueSchema.parse({ status: "UNAVAILABLE" });
    const stale = metricValueSchema.parse({ status: "STALE", value: "0" });
    const estimated = metricValueSchema.parse({ status: "ESTIMATED", value: "0" });
    const awaiting = metricValueSchema.parse({ status: "AWAITING_VERIFICATION" });

    expect(metricHasValue(zero)).toBe(true);
    expect(metricHasValue(stale)).toBe(true);
    expect(metricHasValue(estimated)).toBe(true);
    expect(metricHasValue(unknown)).toBe(false);
    expect(metricHasValue(unavailable)).toBe(false);
    expect(metricHasValue(awaiting)).toBe(false);
    expect(
      new Set([
        zero.status,
        unknown.status,
        unavailable.status,
        stale.status,
        estimated.status,
        awaiting.status
      ]).size
    ).toBe(6);
  });

  it("does not permit absent states to smuggle in a zero", () => {
    expect(metricValueSchema.safeParse({ status: "UNKNOWN", value: "0" }).success).toBe(false);
    expect(metricValueSchema.safeParse({ status: "UNAVAILABLE", value: "0" }).success).toBe(false);
  });
});

describe("separate product and route semantics", () => {
  it("uses discriminators so a route cannot be parsed as a product", () => {
    const route = {
      kind: "ROUTE",
      id: ID,
      productId: "10000000-0000-4000-8000-000000000002",
      name: "Lending route",
      accessMethod: "LENDING_DEPOSIT",
      routeYieldSourceClass: "BORROWER_INTEREST",
      lifecycle: "PUBLISHED"
    };

    expect(routeSchema.safeParse(route).success).toBe(true);
    expect(productSchema.safeParse(route).success).toBe(false);
  });

  it("requires native gold yield to be zero unless a sourced issuer mechanism is verified", () => {
    const nativeGold = {
      kind: "PRODUCT",
      id: ID,
      name: "Test-only gold token",
      symbol: "TSTG",
      category: "GOLD_BACKED_TOKEN",
      lifecycle: "PUBLISHED",
      nativeYieldSourceClass: "NO_NATIVE_YIELD",
      verifiedNativeYieldMechanism: false,
      nativeYieldObservationIds: []
    };
    expect(productSchema.safeParse(nativeGold).success).toBe(true);

    expect(
      productSchema.safeParse({
        ...nativeGold,
        nativeYieldSourceClass: "OTHER_VERIFIED"
      }).success
    ).toBe(false);

    expect(
      productSchema.safeParse({
        ...nativeGold,
        nativeYieldSourceClass: "OTHER_VERIFIED",
        verifiedNativeYieldMechanism: true,
        nativeYieldObservationIds: ["10000000-0000-4000-8000-000000000099"]
      }).success
    ).toBe(true);
  });
});
