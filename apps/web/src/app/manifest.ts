import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#080d10",
    description: "Risk-adjusted yield intelligence for on-chain cash and real-world assets.",
    display: "standalone",
    name: "RWA Yield Router",
    short_name: "Yield Router",
    start_url: "/",
    theme_color: "#080d10"
  };
}
