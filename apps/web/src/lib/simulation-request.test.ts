import { describe, expect, it } from "vitest";
import { simulationRequestSchema } from "./simulation-request";

const validRequest = {
  advancedResearchMode: false,
  capital: "100000.25",
  currentAsset: "USDC",
  currentChain: "Ethereum",
  holdingPeriodDays: "365",
  incentivesAcceptable: false,
  investorClassification: "RETAIL",
  jurisdiction: "IN",
  kycAcceptable: true,
  maximumChainExposure: "60",
  maximumDefiExposure: "50",
  maximumGoldExposure: "15",
  maximumIssuerExposure: "35",
  maximumProductAllocation: "25",
  maximumProtocolExposure: "35",
  maximumRwaExposure: "60",
  minimumConfidence: "MANUALLY_VERIFIED",
  minimumImmediateLiquidity: "20",
  minimumSevenDayLiquidity: "90",
  minimumTwentyFourHourLiquidity: "50",
  preferredChains: ["Ethereum", "Base"],
  profile: "BALANCED",
  saveRequested: false
} as const;

describe("simulation request boundary", () => {
  it("accepts canonical decimal strings and ordered liquidity constraints", () => {
    expect(simulationRequestSchema.parse(validRequest)).toMatchObject(validRequest);
  });

  it.each([
    { capital: "0" },
    { capital: "1e6" },
    { holdingPeriodDays: "NaN" },
    { maximumGoldExposure: "101" },
    { maximumRwaExposure: "-1" },
    { jurisdiction: "IND" },
    { preferredChains: ["Base", "Base"] }
  ])("rejects invalid quantitative or bounded input %#", (override) => {
    expect(simulationRequestSchema.safeParse({ ...validRequest, ...override }).success).toBe(false);
  });

  it("rejects inconsistent liquidity windows before invoking the solver", () => {
    expect(
      simulationRequestSchema.safeParse({
        ...validRequest,
        minimumImmediateLiquidity: "70",
        minimumTwentyFourHourLiquidity: "50"
      }).success
    ).toBe(false);
    expect(
      simulationRequestSchema.safeParse({
        ...validRequest,
        minimumSevenDayLiquidity: "40",
        minimumTwentyFourHourLiquidity: "50"
      }).success
    ).toBe(false);
  });
});
