import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { z } from "zod";

const staticPaths = [
  "/",
  "/dashboard",
  "/screener",
  "/compare",
  "/simulator",
  "/methodology",
  "/sources",
  "/status",
  "/auth/sign-in",
  "/legal/terms",
  "/legal/privacy",
  "/settings",
  "/alerts",
  "/watchlist",
  "/wallet",
  "/simulations",
  "/admin"
] as const;

const categoryPaths = [
  "/category/tokenized-tbill",
  "/category/stablecoin-vault",
  "/category/defi-lending",
  "/category/money-market-token",
  "/category/gold-backed-token",
  "/category/cash-equivalent"
] as const;

async function expectNoSeriousViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const serious = results.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical"
  );
  expect(serious).toEqual([]);
}

for (const path of [...staticPaths, ...categoryPaths]) {
  test(`@a11y ${path} has no serious accessibility violations`, async ({ page }) => {
    await page.goto(path);
    await expectNoSeriousViolations(page);
  });
}

test("@a11y sourced product and route detail pages have no serious accessibility violations", async ({
  page,
  request
}) => {
  test.setTimeout(90_000);
  const response = await request.get("/api/v1/routes?limit=1");
  expect(response.ok()).toBeTruthy();
  const record = z
    .object({
      data: z.array(z.object({ productSlug: z.string().min(1), slug: z.string().min(1) })).length(1)
    })
    .parse(await response.json()).data[0];
  expect(record).toBeDefined();
  await page.goto(`/products/${record?.productSlug ?? "unavailable"}`);
  await expectNoSeriousViolations(page);
  await page.goto(`/routes/${record?.slug ?? "unavailable"}`);
  await expectNoSeriousViolations(page);
});

test("@a11y keyboard focus remains visible through primary navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toBeVisible();
  await expect(focused).toHaveCSS("outline-style", "solid");
});
