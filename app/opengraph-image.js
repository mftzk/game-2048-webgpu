import { ImageResponse } from "next/og";

export const alt = "2048 WebGPU — nrapkén";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0B0B10",
          padding: "72px",
          fontFamily: "sans-serif",
          color: "#F5F2EC",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
          <div
            style={{
              fontSize: "190px",
              fontWeight: 800,
              color: "#FF4B07",
              letterSpacing: "-8px",
              lineHeight: 1,
            }}
          >
            2048
          </div>
          <div
            style={{
              fontSize: "28px",
              fontWeight: 700,
              color: "#2E86FF",
              border: "3px solid #2E86FF",
              borderRadius: "999px",
              padding: "10px 26px",
            }}
          >
            WebGPU
          </div>
        </div>
        <div style={{ fontSize: "46px", color: "#F5F2EC" }}>Gabung angka, capai 2048.</div>
        <div style={{ display: "flex", fontSize: "30px", color: "#9A97A6" }}>nrapkén.dev</div>
      </div>
    ),
    size,
  );
}
