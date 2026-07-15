import { expect, test } from "@playwright/test";
import { z } from "zod";

test("landing, dashboard, and sourced route navigation work", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Know the yield. See the risk. Plan the exit." })
  ).toBeVisible();
  await expect(page.getByText("Read-only and non-custodial")).toBeVisible();
  await page.getByRole("link", { name: /Explore the market/u }).click();
  await expect(page.getByRole("heading", { name: /Yield, access, liquidity/u })).toBeVisible();
  const firstRoute = page.locator('a[href^="/routes/"]').first();
  const firstRouteHref = await firstRoute.getAttribute("href");
  expect(firstRouteHref).toBeTruthy();
  await page.goto(firstRouteHref ?? "/routes/unavailable");
  await expect(page.getByText("Where the return comes from")).toBeVisible();
  await expect(page.getByText("No synthetic points are generated")).toBeVisible();
});

test("screener filters keep unavailable values explicit", async ({ page }) => {
  await page.goto("/screener");
  const search = page.getByPlaceholder("Search product, issuer, protocol, or asset");
  await search.fill("gold");
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText("Unavailable").first()).toBeVisible();
});

test("comparison requires two sourced routes", async ({ page }) => {
  await page.goto("/compare");
  await expect(page.getByRole("heading", { name: "Build a comparison" })).toBeVisible();
  const boxes = page.getByRole("checkbox");
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await page.getByRole("button", { name: "Compare 2" }).click();
  await expect(
    page.getByRole("heading", { name: "What the displayed evidence supports" })
  ).toBeVisible();
});

test("simulation returns a transparent result or infeasibility report", async ({ page }) => {
  await page.goto("/simulator");
  await page.getByRole("button", { name: "Run analytical simulation" }).click();
  await expect(page.locator("#simulation-result")).toBeVisible();
  await expect(page.locator("#simulation-result")).toContainText(
    /Analytical allocation|No feasible allocation/u
  );
});

test("private pages and admin routes fail closed", async ({ page }) => {
  await page.goto("/alerts");
  await expect(
    page.getByRole("heading", { name: "Sign in to use this private workspace" })
  ).toBeVisible();
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
});

test("public API is paginated and source-aware", async ({ request }) => {
  const response = await request.get("/api/v1/routes?limit=2");
  expect(response.ok()).toBeTruthy();
  expect(response.headers().etag).toBeTruthy();
  const body = z
    .object({
      data: z.array(z.object({ source: z.object({ url: z.url() }) })),
      meta: z.object({ count: z.number(), nextCursor: z.string().nullable() })
    })
    .parse(await response.json());
  expect(body.meta.count).toBe(2);
  expect(body.meta.nextCursor).toBeTruthy();
  expect(body.data.every((record) => record.source.url.startsWith("https://"))).toBe(true);
});
