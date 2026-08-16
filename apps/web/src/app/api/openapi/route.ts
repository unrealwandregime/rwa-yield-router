import { jsonWithEtag } from "@/lib/api";

const schemas = {
  Error: {
    properties: {
      error: {
        properties: {
          code: { type: "string" },
          correlationId: { format: "uuid", type: "string" },
          details: {},
          message: { type: "string" }
        },
        required: ["code", "correlationId", "message"],
        type: "object"
      }
    },
    required: ["error"],
    type: "object"
  },
  HistoricalObservation: {
    properties: {
      adapterVersion: { type: "string" },
      confidence: { type: "string" },
      fetchedAt: { format: "date-time", type: "string" },
      id: { format: "uuid", type: "string" },
      metric: { type: "string" },
      observedAt: { format: "date-time", type: "string" },
      sourceRevision: { type: "string" },
      status: { type: "string" },
      unit: { type: "string" },
      verifiedAt: { format: "date-time", nullable: true, type: "string" }
    },
    required: [
      "adapterVersion",
      "confidence",
      "fetchedAt",
      "id",
      "metric",
      "observedAt",
      "sourceRevision",
      "status",
      "unit",
      "verifiedAt"
    ],
    type: "object"
  },
  HistoricalRollup: {
    properties: {
      bucketStart: { format: "date-time", type: "string" },
      calculationVersion: { type: "string" },
      dataCutoff: { format: "date-time", type: "string" },
      id: { format: "uuid", type: "string" },
      updatedAt: { format: "date-time", type: "string" }
    },
    required: ["bucketStart", "calculationVersion", "dataCutoff", "id", "updatedAt"],
    type: "object"
  },
  HistoricalSnapshot: {
    properties: {
      asOf: { format: "date-time", type: "string" },
      calculationVersion: { type: "string" },
      confidence: { type: "string" },
      id: { format: "uuid", type: "string" },
      selectionPolicyVersion: { type: "string" },
      status: { type: "string" }
    },
    required: [
      "asOf",
      "calculationVersion",
      "confidence",
      "id",
      "selectionPolicyVersion",
      "status"
    ],
    type: "object"
  },
  HistoricalSource: {
    properties: {
      code: { type: "string" },
      id: { format: "uuid", type: "string" },
      name: { type: "string" },
      type: { type: "string" },
      url: { format: "uri", type: "string" }
    },
    required: ["code", "id", "name", "type", "url"],
    type: "object"
  },
  HistoricalYieldPoint: {
    properties: {
      asOf: { format: "date-time", type: "string" },
      confidence: { type: "string" },
      netApy: {
        description:
          "Annual percentage-point net APY represented as a decimal string (for example, 4.25 means 4.25%).",
        type: "string"
      },
      observation: { $ref: "#/components/schemas/HistoricalObservation" },
      observedAt: {
        description: "Backward-compatible alias of asOf for v1 clients.",
        format: "date-time",
        type: "string"
      },
      rollup: {
        anyOf: [{ $ref: "#/components/schemas/HistoricalRollup" }, { type: "null" }]
      },
      routeSlug: { type: "string" },
      snapshot: { $ref: "#/components/schemas/HistoricalSnapshot" },
      source: { $ref: "#/components/schemas/HistoricalSource" },
      status: { type: "string" }
    },
    required: [
      "asOf",
      "confidence",
      "netApy",
      "observation",
      "observedAt",
      "rollup",
      "routeSlug",
      "snapshot",
      "source",
      "status"
    ],
    type: "object"
  },
  PageMeta: {
    properties: {
      count: { type: "integer" },
      correlationId: { format: "uuid", type: "string" },
      dataTimestamp: { format: "date-time", nullable: true, type: "string" },
      nextCursor: { nullable: true, type: "string" },
      sourceTimestamp: { format: "date-time", nullable: true, type: "string" },
      total: { type: "integer" }
    },
    required: ["correlationId", "count", "dataTimestamp", "nextCursor", "sourceTimestamp", "total"],
    type: "object"
  },
  PublicSource: {
    additionalProperties: false,
    properties: {
      name: { type: "string" },
      type: { type: "string" },
      url: { format: "uri", type: "string" }
    },
    required: ["name", "type", "url"],
    type: "object"
  },
  MetricState: {
    additionalProperties: false,
    properties: {
      confidence: { type: "string" },
      observedAt: { format: "date-time", type: ["string", "null"] },
      status: {
        enum: [
          "CURRENT",
          "STALE",
          "ESTIMATED",
          "DEGRADED",
          "CONFLICTED",
          "UNKNOWN",
          "UNAVAILABLE",
          "AWAITING_VERIFICATION",
          "REJECTED"
        ]
      }
    },
    required: ["confidence", "observedAt", "status"],
    type: "object"
  },
  Product: {
    additionalProperties: false,
    properties: {
      category: { type: "string" },
      confidence: { type: "string" },
      issuer: { type: "string" },
      lifecycleStatus: { type: "string" },
      name: { type: "string" },
      nativeYield: {
        description: "Native yield in annual percentage points, or null when unavailable.",
        type: ["string", "null"]
      },
      slug: { type: "string" },
      source: { $ref: "#/components/schemas/PublicSource" },
      symbol: { type: "string" },
      verifiedAt: { format: "date-time", type: "string" }
    },
    required: [
      "category",
      "confidence",
      "issuer",
      "lifecycleStatus",
      "name",
      "nativeYield",
      "slug",
      "source",
      "symbol",
      "verifiedAt"
    ],
    type: "object"
  },
  Route: {
    additionalProperties: false,
    properties: {
      accessMethod: { type: "string" },
      aumTvlUsd: { type: ["string", "null"] },
      category: { type: "string" },
      chain: { type: "string" },
      confidence: { type: "string" },
      eligibilitySummary: { type: "string" },
      grossApy: { type: ["string", "null"] },
      id: { type: "string" },
      identitySource: { $ref: "#/components/schemas/PublicSource" },
      issuer: { type: "string" },
      kycRequired: { type: ["boolean", "null"] },
      lifecycleStatus: { type: "string" },
      liquidityUsd: { type: ["string", "null"] },
      methodologyVersion: { type: ["string", "null"] },
      metricStatus: {
        additionalProperties: false,
        properties: {
          aumTvl: { $ref: "#/components/schemas/MetricState" },
          liquidity: { $ref: "#/components/schemas/MetricState" },
          risk: { $ref: "#/components/schemas/MetricState" },
          yield: { $ref: "#/components/schemas/MetricState" }
        },
        required: ["aumTvl", "liquidity", "risk", "yield"],
        type: "object"
      },
      nativeYield: { type: ["string", "null"] },
      netApy: { type: ["string", "null"] },
      observedAt: { format: "date-time", type: ["string", "null"] },
      productName: { type: "string" },
      productSlug: { type: "string" },
      protocol: { type: ["string", "null"] },
      publicationStatus: { enum: ["PUBLISHED", "GATED", "ARCHIVED"] },
      redemptionSummary: { type: "string" },
      riskAdjustedApy: { type: ["string", "null"] },
      riskScore: { type: ["string", "null"] },
      routeName: { type: "string" },
      slug: { type: "string" },
      source: { $ref: "#/components/schemas/PublicSource" },
      sourceObservationIds: { items: { format: "uuid", type: "string" }, type: "array" },
      status: { type: "string" },
      symbol: { type: "string" },
      underlyingAsset: { type: "string" },
      verifiedAt: { format: "date-time", type: "string" },
      warnings: { items: { type: "string" }, type: "array" },
      yieldSource: { type: "string" }
    },
    required: [
      "accessMethod",
      "aumTvlUsd",
      "category",
      "chain",
      "confidence",
      "eligibilitySummary",
      "grossApy",
      "id",
      "identitySource",
      "issuer",
      "kycRequired",
      "lifecycleStatus",
      "liquidityUsd",
      "methodologyVersion",
      "metricStatus",
      "nativeYield",
      "netApy",
      "observedAt",
      "productName",
      "productSlug",
      "protocol",
      "publicationStatus",
      "redemptionSummary",
      "riskAdjustedApy",
      "riskScore",
      "routeName",
      "slug",
      "source",
      "sourceObservationIds",
      "status",
      "symbol",
      "underlyingAsset",
      "verifiedAt",
      "warnings",
      "yieldSource"
    ],
    type: "object"
  },
  YieldMetric: {
    additionalProperties: false,
    properties: {
      grossApy: { type: ["string", "null"] },
      netApy: { type: ["string", "null"] },
      observedAt: { format: "date-time", type: ["string", "null"] },
      riskAdjustedApy: { type: ["string", "null"] },
      routeSlug: { type: "string" },
      source: { $ref: "#/components/schemas/PublicSource" },
      status: { type: "string" }
    },
    required: [
      "grossApy",
      "netApy",
      "observedAt",
      "riskAdjustedApy",
      "routeSlug",
      "source",
      "status"
    ],
    type: "object"
  },
  RiskMetric: {
    additionalProperties: false,
    properties: {
      confidence: { type: "string" },
      methodologyVersion: { type: ["string", "null"] },
      riskAdjustedApy: { type: ["string", "null"] },
      riskScore: { type: ["string", "null"] },
      routeSlug: { type: "string" },
      status: { type: "string" }
    },
    required: [
      "confidence",
      "methodologyVersion",
      "riskAdjustedApy",
      "riskScore",
      "routeSlug",
      "status"
    ],
    type: "object"
  },
  LiquidityMetric: {
    additionalProperties: false,
    properties: {
      availableLiquidityUsd: { type: ["string", "null"] },
      observedAt: { format: "date-time", type: ["string", "null"] },
      redemptionSummary: { type: "string" },
      routeSlug: { type: "string" },
      status: { type: "string" }
    },
    required: ["availableLiquidityUsd", "observedAt", "redemptionSummary", "routeSlug", "status"],
    type: "object"
  },
  AumTvlMetric: {
    additionalProperties: false,
    properties: {
      amountUsd: { type: ["string", "null"] },
      observedAt: { format: "date-time", type: ["string", "null"] },
      routeSlug: { type: "string" },
      status: { type: "string" }
    },
    required: ["amountUsd", "observedAt", "routeSlug", "status"],
    type: "object"
  },
  Category: {
    additionalProperties: false,
    properties: {
      admittedRoutes: { minimum: 0, type: "integer" },
      category: { type: "string" },
      description: { type: "string" },
      label: { type: "string" },
      researchedRecords: { minimum: 0, type: "integer" }
    },
    required: ["admittedRoutes", "category", "description", "label", "researchedRecords"],
    type: "object"
  },
  Methodology: {
    description: "Current methodology publication, or a fail-closed unavailable descriptor.",
    oneOf: [
      {
        additionalProperties: false,
        properties: {
          effectiveAt: { type: "null" },
          label: { type: "string" },
          published: { const: false },
          status: { const: "UNAVAILABLE" },
          version: { type: "null" }
        },
        required: ["effectiveAt", "label", "published", "status", "version"],
        type: "object"
      },
      {
        additionalProperties: false,
        properties: {
          calculationVersion: { type: "string" },
          description: { type: "string" },
          effectiveAt: { format: "date-time", type: ["string", "null"] },
          label: { type: "string" },
          minimumEvidenceCoveragePct: { type: "string" },
          published: { const: true },
          publishedAt: { format: "date-time", type: ["string", "null"] },
          source: { enum: ["DATABASE", "STATIC_FALLBACK"] },
          status: { const: "CURRENT" },
          unknownRiskProxy: { type: "string" },
          version: { type: "string" },
          weights: {
            additionalProperties: {
              additionalProperties: { type: "string" },
              type: "object"
            },
            type: "object"
          }
        },
        required: [
          "calculationVersion",
          "description",
          "effectiveAt",
          "label",
          "minimumEvidenceCoveragePct",
          "published",
          "publishedAt",
          "source",
          "status",
          "unknownRiskProxy",
          "version",
          "weights"
        ],
        type: "object"
      }
    ]
  },
  SimulationRequest: {
    additionalProperties: false,
    properties: {
      advancedResearchMode: { default: false, type: "boolean" },
      capital: { description: "Positive USD capital amount as a decimal string.", type: "string" },
      currentAsset: { maxLength: 128, minLength: 1, type: "string" },
      currentChain: { maxLength: 128, minLength: 1, type: "string" },
      holdingPeriodDays: { description: "Positive decimal day count.", type: "string" },
      incentivesAcceptable: { type: "boolean" },
      investorClassification: {
        enum: ["RETAIL", "ACCREDITED", "QUALIFIED", "PROFESSIONAL", "INSTITUTIONAL"]
      },
      jurisdiction: { pattern: "^[A-Za-z]{2}$", type: "string" },
      kycAcceptable: { type: "boolean" },
      maximumChainExposure: { type: "string" },
      maximumDefiExposure: { type: "string" },
      maximumGoldExposure: { type: "string" },
      maximumIssuerExposure: { type: "string" },
      maximumProductAllocation: { type: "string" },
      maximumProtocolExposure: { type: "string" },
      maximumRwaExposure: { type: "string" },
      minimumConfidence: {
        enum: [
          "VERIFIED_OFFICIAL",
          "ONCHAIN_DERIVED",
          "DIRECT_API",
          "MANUALLY_VERIFIED",
          "THIRD_PARTY"
        ]
      },
      minimumImmediateLiquidity: { type: "string" },
      minimumSevenDayLiquidity: { type: "string" },
      minimumTwentyFourHourLiquidity: { type: "string" },
      name: { maxLength: 120, minLength: 1, type: "string" },
      preferredChains: {
        items: { maxLength: 128, minLength: 1, type: "string" },
        maxItems: 20,
        type: "array"
      },
      profile: {
        enum: ["CAPITAL_PRESERVATION", "CONSERVATIVE", "BALANCED", "YIELD_SEEKING", "CUSTOM"]
      },
      saveRequested: { default: false, type: "boolean" }
    },
    required: [
      "capital",
      "currentAsset",
      "currentChain",
      "holdingPeriodDays",
      "incentivesAcceptable",
      "investorClassification",
      "jurisdiction",
      "kycAcceptable",
      "maximumChainExposure",
      "maximumDefiExposure",
      "maximumGoldExposure",
      "maximumIssuerExposure",
      "maximumProductAllocation",
      "maximumProtocolExposure",
      "maximumRwaExposure",
      "minimumConfidence",
      "minimumImmediateLiquidity",
      "minimumSevenDayLiquidity",
      "minimumTwentyFourHourLiquidity",
      "preferredChains",
      "profile"
    ],
    type: "object"
  },
  SimulationAllocation: {
    additionalProperties: false,
    properties: {
      comparativeRiskAdjustedApy: { type: ["string", "null"] },
      comparativeRiskAdjustedApyBeforeTransactionCosts: { type: "string" },
      netApy: { type: ["string", "null"] },
      netApyBeforeTransactionCosts: { type: "string" },
      percentage: { type: "string" },
      productName: { type: "string" },
      rationale: { type: "string" },
      riskScore: { type: "string" },
      routeName: { type: "string" },
      routeSlug: { type: "string" },
      transactionCostStatus: { enum: ["AVAILABLE", "UNAVAILABLE"] }
    },
    required: [
      "comparativeRiskAdjustedApy",
      "comparativeRiskAdjustedApyBeforeTransactionCosts",
      "netApy",
      "netApyBeforeTransactionCosts",
      "percentage",
      "productName",
      "rationale",
      "riskScore",
      "routeName",
      "routeSlug",
      "transactionCostStatus"
    ],
    type: "object"
  },
  SimulationFeasible: {
    properties: {
      allocations: { items: { $ref: "#/components/schemas/SimulationAllocation" }, type: "array" },
      assumptions: { items: { type: "string" }, type: "array" },
      comparativeRiskAdjustedApy: { type: ["string", "null"] },
      comparativeRiskAdjustedApyBeforeTransactionCosts: { type: "string" },
      dataTimestamp: { format: "date-time", type: "string" },
      grossBlendedApy: { type: "string" },
      immediateLiquidity: { type: "string" },
      methodologyVersion: { type: "string" },
      netBlendedApy: { type: ["string", "null"] },
      netBlendedApyBeforeTransactionCosts: { type: "string" },
      savedSimulationId: { format: "uuid", type: ["string", "null"] },
      sevenDayLiquidity: { type: "string" },
      status: { const: "FEASIBLE" },
      transactionCostStatus: { enum: ["AVAILABLE", "UNAVAILABLE"] },
      twentyFourHourLiquidity: { type: "string" },
      weightedRiskScore: { type: "string" }
    },
    required: [
      "allocations",
      "assumptions",
      "comparativeRiskAdjustedApy",
      "comparativeRiskAdjustedApyBeforeTransactionCosts",
      "dataTimestamp",
      "grossBlendedApy",
      "immediateLiquidity",
      "methodologyVersion",
      "netBlendedApy",
      "netBlendedApyBeforeTransactionCosts",
      "savedSimulationId",
      "sevenDayLiquidity",
      "status",
      "transactionCostStatus",
      "twentyFourHourLiquidity",
      "weightedRiskScore"
    ],
    type: "object"
  },
  SimulationInfeasible: {
    properties: {
      dataTimestamp: { format: "date-time", type: "string" },
      diagnostics: {
        items: {
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            suggestedChange: { type: "string" }
          },
          required: ["code", "message"],
          type: "object"
        },
        type: "array"
      },
      excludedCount: { minimum: 0, type: "integer" },
      methodologyVersion: { type: "string" },
      savedSimulationId: { format: "uuid", type: ["string", "null"] },
      status: { const: "INFEASIBLE" }
    },
    required: [
      "dataTimestamp",
      "diagnostics",
      "excludedCount",
      "methodologyVersion",
      "savedSimulationId",
      "status"
    ],
    type: "object"
  }
};

const historicalYieldResponse = {
  content: {
    "application/json": {
      schema: {
        properties: {
          data: {
            items: { $ref: "#/components/schemas/HistoricalYieldPoint" },
            type: "array"
          },
          meta: { $ref: "#/components/schemas/PageMeta" }
        },
        required: ["data", "meta"],
        type: "object"
      }
    }
  },
  description: "Historical net APY points with per-point snapshot and source observation provenance"
};

const errorResponse = (description: string) => ({
  content: {
    "application/json": { schema: { $ref: "#/components/schemas/Error" } }
  },
  description
});

const pageResponse = (itemSchema: string, description: string) => ({
  content: {
    "application/json": {
      schema: {
        properties: {
          data: { items: { $ref: `#/components/schemas/${itemSchema}` }, type: "array" },
          meta: { $ref: "#/components/schemas/PageMeta" }
        },
        required: ["data", "meta"],
        type: "object"
      }
    }
  },
  description
});

const simulationResponse = {
  content: {
    "application/json": {
      schema: {
        oneOf: [
          { $ref: "#/components/schemas/SimulationFeasible" },
          { $ref: "#/components/schemas/SimulationInfeasible" }
        ]
      }
    }
  },
  description: "A deterministic analytical allocation or a no-allocation infeasibility report"
};

export function GET() {
  const paginatedResources = {
    "aum-tvl": "AumTvlMetric",
    categories: "Category",
    liquidity: "LiquidityMetric",
    methodologies: "Methodology",
    products: "Product",
    risk: "RiskMetric",
    routes: "Route",
    sources: "PublicSource",
    yield: "YieldMetric"
  } as const;
  const paginatedPaths = Object.fromEntries(
    Object.entries(paginatedResources).map(([resource, itemSchema]) => [
      `/api/v1/${resource}`,
      {
        get: {
          parameters: [
            { in: "query", name: "cursor", schema: { type: "string" } },
            {
              in: "query",
              name: "limit",
              schema: { maximum: 100, minimum: 1, type: "integer" }
            }
          ],
          responses: {
            "200": pageResponse(itemSchema, "A sourced page of public data"),
            "400": errorResponse("Validation error"),
            "404": errorResponse("Unknown public resource"),
            "429": errorResponse("Rate limited")
          },
          summary: `List ${resource}`
        }
      }
    ])
  );

  return jsonWithEtag(
    {
      info: {
        description: "Sourced public read API for RWA Yield Router.",
        title: "RWA Yield Router API",
        version: "1.3.0"
      },
      openapi: "3.1.1",
      paths: {
        ...paginatedPaths,
        "/api/v1/comparison": {
          get: {
            parameters: [
              {
                description: "Two to five unique route slugs, comma-separated or repeated.",
                in: "query",
                name: "routes",
                required: true,
                schema: { type: "string" }
              }
            ],
            responses: {
              "200": pageResponse("Route", "Current sourced records in requested comparison order"),
              "400": errorResponse("Validation error"),
              "404": errorResponse("A requested route was not found"),
              "429": errorResponse("Rate limited")
            },
            summary: "Compare sourced routes"
          }
        },
        "/api/v1/historical-yield": {
          get: {
            parameters: [
              { in: "query", name: "route", required: true, schema: { type: "string" } },
              { in: "query", name: "cursor", schema: { type: "string" } },
              {
                in: "query",
                name: "limit",
                schema: { maximum: 100, minimum: 1, type: "integer" }
              }
            ],
            responses: {
              "200": historicalYieldResponse,
              "400": errorResponse("Validation error"),
              "404": errorResponse("Route not found"),
              "429": errorResponse("Rate limited")
            },
            summary: "List historical yield for a route"
          }
        },
        "/api/v1/historical-yield/{slug}": {
          get: {
            parameters: [{ in: "path", name: "slug", required: true, schema: { type: "string" } }],
            responses: {
              "200": historicalYieldResponse,
              "404": errorResponse("Route not found"),
              "429": errorResponse("Rate limited")
            },
            summary: "Get route historical yield"
          }
        },
        "/api/v1/simulations": {
          post: {
            description:
              "Runs a non-custodial analytical simulation. Unknown user transaction costs exclude routes in standard mode. Explicit advanced research may return before-cost metrics while after-cost net metrics remain null.",
            parameters: [
              {
                description: "Double-submit CSRF token matching the same-origin CSRF cookie.",
                in: "header",
                name: "x-rwa-csrf-token",
                required: true,
                schema: { type: "string" }
              }
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/SimulationRequest" }
                }
              },
              required: true
            },
            responses: {
              "200": simulationResponse,
              "400": errorResponse("Validation error"),
              "401": errorResponse("Authentication is required when saveRequested is true"),
              "403": errorResponse("Origin or CSRF validation failed"),
              "413": errorResponse("Request body exceeds the 16 KiB simulation limit"),
              "415": errorResponse("Content-Type must be application/json"),
              "429": errorResponse("Simulation rate limited"),
              "503": errorResponse(
                "Methodology, evidence, or canonical save references unavailable"
              )
            },
            summary: "Run an analytical route simulation"
          }
        }
      },
      components: { schemas },
      servers: [{ url: "/" }]
    },
    { cacheSeconds: 3600 }
  );
}
