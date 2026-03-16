import CesiumKMZ from "@/components/CesiumKMZ";
import HelpPanel from "@/components/HelpPanel";

export default function HomePage() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <CesiumKMZ />
      <HelpPanel />
    </main>
  );
}
