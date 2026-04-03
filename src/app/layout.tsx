import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CC GEOLAB",
  description: "Cesium-based 3D drone-style viewer for KMZ/KML geological data",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
