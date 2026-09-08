import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
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
          fontSize: 15,
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
