const compactUsd = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency"
});

const decimalPercent = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "percent"
});

export const formatUsd = (value: string | null): string => {
  if (value === null) return "Unavailable";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? compactUsd.format(parsed) : "Unavailable";
};

export const formatPercent = (value: string | null): string => {
  if (value === null) return "Unavailable";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? decimalPercent.format(parsed / 100) : "Unavailable";
};

export const formatRisk = (value: string | null): string => {
  if (value === null) return "Not scored";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "Unavailable";
  if (parsed <= 20) return `${parsed.toFixed(0)} · Low`;
  if (parsed <= 40) return `${parsed.toFixed(0)} · Low to moderate`;
  if (parsed <= 60) return `${parsed.toFixed(0)} · Moderate`;
  if (parsed <= 80) return `${parsed.toFixed(0)} · High`;
  return `${parsed.toFixed(0)} · Very high`;
};

export const formatTimestamp = (value: string | null): string => {
  if (value === null) return "Awaiting first observation";
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf())
    ? "Unavailable"
    : new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC"
      }).format(parsed) + " UTC";
};

export const csvSafe = (value: string): string => {
  const neutralized = /^[=+\-@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${neutralized.replaceAll('"', '""')}"`;
};
