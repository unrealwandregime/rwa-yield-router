import { describe, expect, it } from "vitest";

import { connectionOptionsFromUrl } from "./runtime.js";

describe("Redis worker connection options", () => {
  it("keeps the command timeout longer than the configured BullMQ drain delay", () => {
    expect(
      connectionOptionsFromUrl("rediss://default:secret@redis.example.com:6379", 30)
    ).toMatchObject({
      commandTimeout: 35_000,
      connectTimeout: 5_000,
      host: "redis.example.com",
      password: "secret",
      port: 6379,
      tls: {},
      username: "default"
    });
  });

  it("allows BullMQ's event wait when the drain delay is shorter", () => {
    expect(connectionOptionsFromUrl("redis://localhost:6379", 5)).toMatchObject({
      commandTimeout: 15_000
    });
  });
});
