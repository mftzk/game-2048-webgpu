import "./globals.css";

export const metadata = {
  metadataBase: new URL("https://game-2048-webgpu.quick.nrapken.dev"),
  title: "2048 WebGPU — nrapkén",
  description:
    "2048 versi WebGPU: board, angka, dan partikel dirender di GPU dengan WGSL, plus fallback Canvas 2D otomatis.",
  applicationName: "2048 WebGPU",
  keywords: ["2048", "WebGPU", "WGSL", "game", "nrapkén"],
  openGraph: {
    title: "2048 WebGPU — nrapkén",
    description:
      "Gabung angka, capai 2048. Board dirender di GPU dengan WebGPU + WGSL dan fallback Canvas 2D.",
    url: "https://game-2048-webgpu.quick.nrapken.dev",
    siteName: "2048 WebGPU",
    type: "website",
    locale: "id_ID",
  },
  twitter: {
    card: "summary_large_image",
    title: "2048 WebGPU — nrapkén",
    description:
      "Gabung angka, capai 2048. Board dirender di GPU dengan WebGPU + WGSL dan fallback Canvas 2D.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0B10",
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
