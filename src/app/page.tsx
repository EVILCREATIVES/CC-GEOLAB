"use client";

import CesiumKMZ from "@/components/CesiumKMZ";
import HelpPanel from "@/components/HelpPanel";
import ConvertPanel from "@/components/ConvertPanel";
import SettingsPanel from "@/components/SettingsPanel";
import { GeoDataProvider } from "@/context/GeoDataContext";

export default function HomePage() {
  return (
    <GeoDataProvider>
      <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
        <CesiumKMZ />
        <HelpPanel />
        <ConvertPanel />
        <SettingsPanel />
      </main>
    </GeoDataProvider>
  );
}
