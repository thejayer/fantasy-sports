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
          background: "#ec3013",
          color: "#f3f2f2",
          fontSize: 78,
          fontWeight: 800,
          letterSpacing: "-0.05em",
        }}
      >
        SJ
      </div>
    ),
    { ...size },
  );
}
