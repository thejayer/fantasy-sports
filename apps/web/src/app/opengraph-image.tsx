import { ImageResponse } from "next/og";

export const alt = "Strictly Jayers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Generated OG card — no static asset to keep in sync (roadmap 3.6). */
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background:
            "linear-gradient(145deg, #0f2a20 0%, #1f4d3a 55%, #13231c 100%)",
          color: "#eef3ec",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 42,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.75,
          }}
        >
          Member hub
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 96,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              lineHeight: 0.95,
            }}
          >
            Strictly Jayers
          </div>
          <div style={{ fontSize: 34, opacity: 0.85, maxWidth: 820 }}>
            Standings, matchups, and a decade of league history.
          </div>
        </div>
        <div
          style={{
            width: 120,
            height: 10,
            background: "#d2f15b",
            borderRadius: 999,
          }}
        />
      </div>
    ),
    { ...size },
  );
}
