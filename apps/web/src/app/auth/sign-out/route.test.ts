import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => null)
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sign-out route", () => {
  it("redirects to the canonical public origin behind an internal HTTP proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const token = "A".repeat(43);
    const request = new NextRequest("http://render-internal:10000/auth/sign-out", {
      headers: {
        cookie: `__Host-rwa-csrf=${token}`,
        origin: "https://router.example",
        "sec-fetch-site": "same-origin",
        "x-forwarded-host": "attacker.invalid",
        "x-forwarded-proto": "http",
        "x-rwa-csrf-token": token
      },
      method: "POST"
    });

    const response = await POST(request);

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://router.example/");
  });
});
