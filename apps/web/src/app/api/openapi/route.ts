import { jsonWithEtag } from "@/lib/api";

const schemas = {
  Error: {
    properties: {
      error: {
        properties: {
          code: { type: "string" },
          correlationId: { format: "uuid", type: "string" },
          message: { type: "string" }
        },
        required: ["code", "correlationId", "message"],
        type: "object"
      }
    },
    required: ["error"],
    type: "object"
  },
  PageMeta: {
    properties: {
      count: { type: "integer" },
      dataTimestamp: { format: "date-time", nullable: true, type: "string" },
      nextCursor: { nullable: true, type: "string" },
      sourceTimestamp: { format: "date-time", nullable: true, type: "string" },
      total: { type: "integer" }
    },
    type: "object"
  }
};

export function GET() {
  return jsonWithEtag(
    {
      info: {
        description: "Sourced public read API for RWA Yield Router.",
        title: "RWA Yield Router API",
        version: "1.0.0"
      },
      openapi: "3.1.1",
      paths: Object.fromEntries(
        [
          "products",
          "routes",
          "yield",
          "risk",
          "liquidity",
          "aum-tvl",
          "sources",
          "categories",
          "methodologies"
        ].map((resource) => [
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
                "200": { description: "A sourced page of public data" },
                "400": { description: "Validation error" },
                "429": { description: "Rate limited" }
              },
              summary: `List ${resource}`
            }
          }
        ])
      ),
      components: { schemas },
      servers: [{ url: "/" }]
    },
    { cacheSeconds: 3600 }
  );
}
