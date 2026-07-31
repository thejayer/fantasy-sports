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
          background: "#ec3013",
          color: "#f3f2f2",
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            fontSize: 22,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            opacity: 0.9,
          }}
        >
          The front door
        </div>
        <div
          style={{
            marginTop: 20,
            fontSize: 96,
            fontWeight: 800,
            letterSpacing: "-0.03em",
            textTransform: "uppercase",
            lineHeight: 0.9,
            maxWidth: 900,
          }}
        >
          Strictly Jayers
        </div>
        <div
          style={{
            marginTop: 36,
            width: "100%",
            height: 2,
            background: "#f3f2f2",
          }}
        />
        <div
          style={{
            marginTop: 28,
            fontSize: 34,
            fontWeight: 700,
            maxWidth: 720,
          }}
        >
          Same crew. Different rooms.
        </div>
      </div>
    ),
    { ...size },
  );
}
