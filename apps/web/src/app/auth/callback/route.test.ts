import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => null)
}));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication callback route", () => {
  it("uses the canonical public origin for configuration failures behind a proxy", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://router.example");
    vi.stubEnv("EMAIL_TRANSPORT", "disabled");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const request = new NextRequest("http://render-internal:10000/auth/callback");

    const response = await GET(request);

    expect(response.headers.get("location")).toBe(
      "https://router.example/auth/sign-in?error=configuration"
    );
  });
});
