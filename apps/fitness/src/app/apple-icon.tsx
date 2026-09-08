import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          background: "#f3f2f2",
          color: "#201e1d",
          fontSize: 72,
          fontWeight: 800,
          letterSpacing: "-0.05em",
          border: "10px solid #201e1d",
        }}
      >
        <div
          style={{
            display: "flex",
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 14,
            background: "#ec3013",
          }}
        />
        SJ
      </div>
    ),
    { ...size },
  );
}
