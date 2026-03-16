"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type GeoEntity = {
  name: string;
  folder: string;
  type: "point" | "polyline" | "polygon" | "label" | "other";
  properties: Record<string, string | number>;
};

export type GeoFileSummary = {
  fileName: string;
  folderNames: string[];
  entityCount: number;
  entities: GeoEntity[];
  /** compact text block for LLM context (truncated to ~6k chars) */
  llmContext: string;
};

type GeoDataContextType = {
  summary: GeoFileSummary | null;
  setSummary: (s: GeoFileSummary | null) => void;
};

const GeoDataContext = createContext<GeoDataContextType>({
  summary: null,
  setSummary: () => {},
});

export function GeoDataProvider({ children }: { children: ReactNode }) {
  const [summary, setSummaryRaw] = useState<GeoFileSummary | null>(null);
  const setSummary = useCallback((s: GeoFileSummary | null) => setSummaryRaw(s), []);
  return (
    <GeoDataContext.Provider value={{ summary, setSummary }}>
      {children}
    </GeoDataContext.Provider>
  );
}

export function useGeoData() {
  return useContext(GeoDataContext);
}
