import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Strictly Jayers";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "72px",
          background:
            "linear-gradient(155deg, #1a2433 0%, #243041 48%, #0e7f8c 100%)",
          color: "#f4f7fb",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 88,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            textTransform: "uppercase",
            lineHeight: 0.95,
            maxWidth: 900,
          }}
        >
          Strictly Jayers
        </div>
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            opacity: 0.85,
            maxWidth: 720,
          }}
        >
          Community home — Discord, games, fantasy hub.
        </div>
        <div
          style={{
            marginTop: 40,
            width: 160,
            height: 10,
            background: "#1aa6b7",
          }}
        />
      </div>
    ),
    { ...size },
  );
}
