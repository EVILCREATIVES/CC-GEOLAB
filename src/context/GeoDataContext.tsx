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
  /** centroid of all entities on the map, used for location-based titling */
  centroid: { lat: number; lon: number } | null;
};

export type UserInfo = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
};

/** The 3D-converted KML currently loaded in the viewer, ready to be re-zipped as a KMZ. */
export type ProcessedKml = {
  /** source file name the KML was derived from (e.g. "survey.kmz") */
  fileName: string;
  /** full KML text after DEM/3D conversion (and geoid correction, when applied) */
  kml: string;
};

type GeoDataContextType = {
  summary: GeoFileSummary | null;
  setSummary: (s: GeoFileSummary | null) => void;
  processedKml: ProcessedKml | null;
  setProcessedKml: (p: ProcessedKml | null) => void;
  user: UserInfo | null;
  setUser: (u: UserInfo | null) => void;
};

const GeoDataContext = createContext<GeoDataContextType>({
  summary: null,
  setSummary: () => {},
  processedKml: null,
  setProcessedKml: () => {},
  user: null,
  setUser: () => {},
});

export function GeoDataProvider({ children }: { children: ReactNode }) {
  const [summary, setSummaryRaw] = useState<GeoFileSummary | null>(null);
  const [processedKml, setProcessedKmlRaw] = useState<ProcessedKml | null>(null);
  const [user, setUserRaw] = useState<UserInfo | null>(null);
  const setSummary = useCallback((s: GeoFileSummary | null) => setSummaryRaw(s), []);
  const setProcessedKml = useCallback((p: ProcessedKml | null) => setProcessedKmlRaw(p), []);
  const setUser = useCallback((u: UserInfo | null) => setUserRaw(u), []);
  return (
    <GeoDataContext.Provider
      value={{ summary, setSummary, processedKml, setProcessedKml, user, setUser }}
    >
      {children}
    </GeoDataContext.Provider>
  );
}

export function useGeoData() {
  return useContext(GeoDataContext);
}
