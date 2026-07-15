import { ImageResponse } from "next/og";

export const alt = "RWA Yield Router — know the yield, see the risk, plan the exit";
export const contentType = "image/png";
export const size = { height: 630, width: 1200 };

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        background: "#080d10",
        color: "#e7edef",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "space-between",
        padding: "70px 78px",
        width: "100%"
      }}
    >
      <div
        style={{ alignItems: "center", display: "flex", fontSize: 28, fontWeight: 700, gap: 16 }}
      >
        <span
          style={{
            alignItems: "center",
            background: "#55c7aa",
            borderRadius: 12,
            color: "#080d10",
            display: "flex",
            height: 54,
            justifyContent: "center",
            width: 54
          }}
        >
          R
        </span>
        RWA Yield Router
      </div>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span
          style={{
            color: "#55c7aa",
            fontSize: 20,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: "uppercase"
          }}
        >
          Non-custodial analytical routing
        </span>
        <span
          style={{
            fontSize: 76,
            fontWeight: 760,
            letterSpacing: -4,
            lineHeight: 1.02,
            marginTop: 24,
            maxWidth: 980
          }}
        >
          Know the yield.
          <br />
          See the risk. Plan the exit.
        </span>
      </div>
      <div style={{ color: "#9aa8ae", display: "flex", fontSize: 22, gap: 26 }}>
        <span>Tokenized Treasuries</span>
        <span>Stablecoin vaults</span>
        <span>DeFi lending</span>
        <span>Gold</span>
      </div>
    </div>,
    size
  );
}
