"use client";

import CesiumKMZ from "@/components/CesiumKMZ";
import HelpPanel from "@/components/HelpPanel";
import { GeoDataProvider } from "@/context/GeoDataContext";

export default function HomePage() {
  return (
    <GeoDataProvider>
      <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
        <CesiumKMZ />
        <HelpPanel />
      </main>
    </GeoDataProvider>
  );
}
