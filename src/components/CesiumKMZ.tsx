"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { useEffect, useRef, useState, useCallback } from "react";
import { useGeoData, type GeoEntity, type GeoFileSummary, type UserInfo } from "@/context/GeoDataContext";

function ensureHeadAsset(tag: "link" | "script", attrs: Record<string, string>) {
  const selector = tag === "link" ? `link[href="${attrs.href}"]` : `script[src="${attrs.src}"]`;
  if (document.head.querySelector(selector)) return;

  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  document.head.appendChild(el);
}

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.readAsArrayBuffer(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error);
    r.onload = () => resolve(String(r.result ?? ""));
    r.readAsText(file);
  });
}

async function waitForGlobal(name: string, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = (window as any)[name];
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

// ── Instant client-side KML 3D depth transform (string-based) ──
const DEPTH_RE = /(\d+(?:\.\d+)?)\s*'?\s*[-–]\s*(\d+(?:\.\d+)?)\s*(m|ft|feet|foot|'|meter|meters)?\s*'?\s*$/i;
const FEET_SET = new Set(["ft", "feet", "foot", "'"]);
const HALF_LON = 0.0001;
const HALF_LAT = 0.000075;

function transformKmlFor3D(kml: string): string {
  // Use a regex to find each <Placemark>…</Placemark> block that has a Point
  const pmRe = /<Placemark\b[^>]*>([\s\S]*?)<\/Placemark>/gi;
  const nameRe = /<name>\s*<!\[CDATA\[(.*?)\]\]>\s*<\/name>|<name>(.*?)<\/name>/i;
  const coordRe = /<Point[^>]*>[\s\S]*?<coordinates>\s*([\d.eE+-]+),([\d.eE+-]+)/i;
  const styleRe = /<styleUrl>(.*?)<\/styleUrl>/i;

  let count = 0;

  const result = kml.replace(pmRe, (fullMatch, inner: string) => {
    const nm = nameRe.exec(inner);
    const rawName = (nm?.[1] ?? nm?.[2] ?? "").trim();
    const dm = DEPTH_RE.exec(rawName);
    if (!dm) return fullMatch;

    const cm = coordRe.exec(inner);
    if (!cm) return fullMatch;

    const lon = parseFloat(cm[1]);
    const lat = parseFloat(cm[2]);
    if (isNaN(lon) || isNaN(lat)) return fullMatch;

    const d1 = parseFloat(dm[1]);
    const d2 = parseFloat(dm[2]);
    const unit = dm[3] || "'";
    const isFeet = FEET_SET.has(unit.toLowerCase());
    const factor = isFeet ? 0.3048 : 1;
    const topM = Math.min(d1, d2) * factor;
    const botM = Math.max(d1, d2) * factor;
    const uLabel = isFeet ? "'" : "m";

    const baseName = rawName.slice(0, dm.index).replace(/[\s/\\]+$/, "").trim() || "Deposit";

    // Detect commodity from name for coloring
    const commodityPatterns: [RegExp, string][] = [
      [/\b(Au|Gold)\b/i, "Gold"], [/\b(Cu|Copper)\b/i, "Copper"],
      [/\b(Li|Lithium)\b/i, "Lithium"], [/\b(Ag|Silver)\b/i, "Silver"],
      [/(Oil|Petroleum|Crude)/i, "Oil & Gas"], [/(Ground\s*Water|Water\s*Table)/i, "Ground Water"],
    ];
    let commodity = "";
    for (const [rx, label] of commodityPatterns) { if (rx.test(rawName)) { commodity = label; break; } }

    const sm = styleRe.exec(inner);
    const styleTag = sm ? `<styleUrl>${sm[1]}</styleUrl>` : "";
    const depthData = `<ExtendedData><Data name="_3dDepth"><value>true</value></Data><Data name="source"><value>${commodity}</value></Data></ExtendedData>`;

    const c = [
      [lon - HALF_LON, lat - HALF_LAT],
      [lon + HALF_LON, lat - HALF_LAT],
      [lon + HALF_LON, lat + HALF_LAT],
      [lon - HALF_LON, lat + HALF_LAT],
    ];
    const f = (lo: number, la: number, z: number) =>
      `${lo.toFixed(10)},${la.toFixed(10)},${z.toFixed(4)}`;

    const topFace = c.map(([lo, la]) => f(lo, la, -topM)).join(" ") + " " + f(c[0][0], c[0][1], -topM);
    const botFace = c.map(([lo, la]) => f(lo, la, -botM)).join(" ") + " " + f(c[0][0], c[0][1], -botM);

    // Build separate wall Placemarks (one per edge)
    const wallPms = [[0,1],[1,2],[2,3],[3,0]].map(([i,j], idx) =>
      `<Placemark>
<name>${baseName} min depth polygon wall ${idx + 1}</name>
${depthData}
<Polygon><tessellate>0</tessellate><extrude>0</extrude><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${
        f(c[i][0],c[i][1],-topM)} ${f(c[j][0],c[j][1],-topM)} ${f(c[j][0],c[j][1],-botM)} ${f(c[i][0],c[i][1],-botM)} ${f(c[i][0],c[i][1],-topM)
      }</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>`
    ).join("\n");

    count++;

    return `<Placemark>
<name>${baseName}/ Top ${dm[1]}${uLabel}</name>
${styleTag}
${depthData}
<Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${lon},${lat},${-topM}</coordinates></Point>
</Placemark>
<Placemark>
<name>${baseName}/ Bottom ${dm[2]}${uLabel}</name>
${styleTag}
${depthData}
<Point><altitudeMode>relativeToGround</altitudeMode><coordinates>${lon},${lat},${-botM}</coordinates></Point>
</Placemark>
<Placemark>
<name>${baseName} min depth polygon</name>
${depthData}
<Polygon><tessellate>0</tessellate><extrude>0</extrude><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${topFace}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>
<Placemark>
<name>${baseName} max depth polygon</name>
${depthData}
<Polygon><tessellate>0</tessellate><extrude>0</extrude><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>${botFace}</coordinates></LinearRing></outerBoundaryIs></Polygon>
</Placemark>
${wallPms}`;
  });

  console.log(`[3D Transform] Converted ${count} depth placemarks`);
  return result;
}

export default function CesiumKMZ() {
  const readyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { setSummary, user } = useGeoData();

  useEffect(() => {
    const rootNode = rootRef.current;
    ensureHeadAsset("link", {
      rel: "stylesheet",
      href: "https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Widgets/widgets.css",
    });
    ensureHeadAsset("script", {
      src: "https://cesium.com/downloads/cesiumjs/releases/1.120/Build/Cesium/Cesium.js",
      defer: "true",
    });

    ensureHeadAsset("script", {
      src: "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js",
      defer: "true",
    });

    let joystickInterval: number | undefined;
    let viewer: any;

    const onResize = () => viewer?.scene && viewer.resize();

    // Log page visit (fire-and-forget)
    fetch("/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: "/" }),
    }).catch(() => {});

    function initWhenReady() {
      const Cesium = (window as any).Cesium;
      if (!Cesium || !containerRef.current) {
        requestAnimationFrame(initWhenReady);
        return;
      }
      if (readyRef.current) return;
      readyRef.current = true;

      const token = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN;
      if (token) {
        Cesium.Ion.defaultAccessToken = token;
      }

      viewer = new Cesium.Viewer(containerRef.current, {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        animation: false,
        timeline: false,
        requestRenderMode: true,
        maximumRenderTimeChange: Infinity,
      });

      viewer.scene.screenSpaceCameraController.enableCollisionDetection = false;
      viewer.scene.globe.translucency.enabled = true;
      viewer.scene.globe.translucency.frontFaceAlpha = 0.4;
      viewer.scene.globe.depthTestAgainstTerrain = false;

      setTimeout(() => viewer.resize(), 0);
      window.addEventListener("resize", onResize);

      viewer.selectedEntityChanged.addEventListener((ent: any) => {
        if (!ent) return;
        const now = Cesium.JulianDate.now ? Cesium.JulianDate.now() : undefined;

        const html = ent.description?.getValue?.(now) ?? ent.description ?? "";
        if (typeof html !== "string" || !html) return;

        const rowRe = /<tr>\s*<th>(.*?)<\/th>\s*<td>(.*?)<\/td>\s*<\/tr>/gi;

        const rename = (label: string) => {
          const l = label.trim().toLowerCase();
          if (l.includes("surface") || l.includes("surfacez_m")) return "Surface (m a.s.l.)";
          if (l.includes("minz") || l.includes("min elevation")) return "Elevation - Min (m a.s.l.)";
          if (l.includes("maxz") || l.includes("max elevation")) return "Elevation - Max (m a.s.l.)";
          if (l.includes("mindepth") || l.includes("min depth")) return "Depth - Min (m b.g.l.)";
          if (l.includes("maxdepth") || l.includes("max depth")) return "Depth - Max (m b.g.l.)";
          if (l.includes("source")) return "Data Source";
          return label;
        };

        const toNum = (v: string) => {
          const n = parseFloat(v.replace(/[^0-9.\-eE+]/g, ""));
          return Number.isFinite(n) ? n : NaN;
        };
        const mToFt = (m: number) => m * 3.28084;

        const rows: string[] = [];
        let minD: number | undefined;
        let maxD: number | undefined;

        html.replace(rowRe, (_m: string, label: string, val: string) => {
          const newLabel = rename(label);
          const n = toNum(val);
          const mCell = Number.isFinite(n) ? n.toFixed(3) : "-";
          const ftCell = Number.isFinite(n) ? mToFt(n).toFixed(3) : "-";

          if (/Min Depth/i.test(label)) minD = Number.isFinite(n) ? n : undefined;
          if (/Max Depth/i.test(label)) maxD = Number.isFinite(n) ? n : undefined;

          rows.push(`<tr><th>${newLabel}</th><td>${mCell}</td><td>${ftCell}</td></tr>`);
          return "";
        });

        const elevMin = rows.find((r) => /Elevation - Min/.test(r));
        const elevMax = rows.find((r) => /Elevation - Max/.test(r));
        if (elevMin && elevMax) {
          const getVal = (row: string) => {
            const m = row.match(/<td>([\d.]+)<\/td>/);
            return m ? parseFloat(m[1]) : NaN;
          };
          const minVal = getVal(elevMin);
          const maxVal = getVal(elevMax);
          if (isFinite(minVal) && isFinite(maxVal)) {
            const diff = Math.abs(maxVal - minVal);
            rows.push(`<tr><th>Thickness(Max-Min)</th><td>${diff.toFixed(3)}</td><td>${mToFt(diff).toFixed(3)}</td></tr>`);
          }
        }

        if (minD != null && maxD != null) {
          const th = maxD - minD;
          rows.push(`<tr><th>Thickness</th><td>${th.toFixed(3)}</td><td>${mToFt(th).toFixed(3)}</td></tr>`);
        }

        if (rows.length) {
          ent.description = `<table class="cesium-infoBox-defaultTable">
<tr><th></th><th>Value (m)</th><th>Value (ft)</th></tr>
${rows.join("")}
</table>`;
        }
      });

      const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

      const up = $<HTMLInputElement>("uploader");
      const chkCu = $<HTMLInputElement>("chkCu");
      const chkAu = $<HTMLInputElement>("chkAu");
      const chkOil = $<HTMLInputElement>("chkOil");
      const chkWater = $<HTMLInputElement>("chkWater");
      const chkGas = $<HTMLInputElement>("chkGas");
      const chkVoid = $<HTMLInputElement>("chkVoid");

      const chkLabels = $<HTMLInputElement>("chkLabels");
      const chkPins = $<HTMLInputElement>("chkPins");
      const chkSurf = $<HTMLInputElement>("chkSurf");
      const chkMin = $<HTMLInputElement>("chkMin");
      const chkMax = $<HTMLInputElement>("chkMax");
      const chkCol = $<HTMLInputElement>("chkCol");

      const alpha = $<HTMLInputElement>("alpha");
      const rad = $<HTMLInputElement>("rad");
      const btnLoad = $<HTMLButtonElement>("btnLoad");

      const FOLDER_COLOR: Record<string, any> = {
        Cu: Cesium.Color.fromBytes(184, 115, 51, 255),
        Au: Cesium.Color.fromBytes(255, 215, 0, 255),
        Oil: Cesium.Color.fromBytes(0, 0, 0, 255),
        H2O: Cesium.Color.fromBytes(74, 134, 255, 255),
        Gas: Cesium.Color.fromBytes(110, 168, 163, 255),
        Void: Cesium.Color.fromBytes(123, 225, 52, 255),
      };

      // Map commodity names (from ExtendedData.source) → colors
      const COMMODITY_COLOR: Record<string, any> = {
        Copper:           Cesium.Color.fromBytes(184, 115, 51, 255),
        Gold:             Cesium.Color.fromBytes(255, 215, 0, 255),
        Silver:           Cesium.Color.fromBytes(192, 192, 192, 255),
        Lithium:          Cesium.Color.fromBytes(200, 230, 255, 255),
        "Oil & Gas":      Cesium.Color.fromBytes(40, 40, 40, 255),
        "Ground Water":   Cesium.Color.fromBytes(74, 134, 255, 255),
        "Buried Treasure": Cesium.Color.fromBytes(218, 165, 32, 255),
        "Ship Wrecks":    Cesium.Color.fromBytes(139, 90, 43, 255),
        Explosives:       Cesium.Color.fromBytes(255, 60, 60, 255),
        "Ancient Ruins":  Cesium.Color.fromBytes(180, 160, 120, 255),
      };
      // Also map folder shorthand to the same
      COMMODITY_COLOR.Cu = COMMODITY_COLOR.Copper;
      COMMODITY_COLOR.Au = COMMODITY_COLOR.Gold;
      COMMODITY_COLOR.Ag = COMMODITY_COLOR.Silver;
      COMMODITY_COLOR.Li = COMMODITY_COLOR.Lithium;
      COMMODITY_COLOR.Oil = COMMODITY_COLOR["Oil & Gas"];
      COMMODITY_COLOR.H2O = COMMODITY_COLOR["Ground Water"];
      COMMODITY_COLOR.Gas = Cesium.Color.fromBytes(110, 168, 163, 255);
      COMMODITY_COLOR.Void = Cesium.Color.fromBytes(123, 225, 52, 255);

      const DEPOSIT_ALPHA = 0.35;
      const COLUMN_COLOR = Cesium.Color.MAGENTA.withAlpha(0.92);

      let ds: any = null;
      const columnEntities: any[] = [];
      let lastFile: File | null = null;

      const hasProp = (e: any, key: string) => e.properties && e.properties[key] != null;
      const colorOfFolder = (name: string) => FOLDER_COLOR[name] || Cesium.Color.WHITE;

      function colorizeFolder(dsLocal: any, folderName: string) {
        const col = colorOfFolder(folderName);
        if (!col) return;
        const now = Cesium.JulianDate.now();
        for (const e of dsLocal.entities.values) {
          const p = e.parent;
          if (!p || p.name !== folderName) continue;

          if (e.point) e.point.color = col;
          if (e.billboard) e.billboard.color = col;
          if (e.label) e.label.fillColor = col;

          if (e.polyline) {
            let width = 2.0;
            try {
              const wp = e.polyline.width;
              width = Cesium.defined(wp) ? (wp.getValue ? wp.getValue(now) : Number(wp)) : 2.0;
            } catch {
              width = 2.0;
            }
            e.polyline.width = Math.max(1.0, width || 2.0);

            const isMax = e.name && /\bmax\b/i.test(e.name);
            if (isMax) {
              e.polyline.material = new Cesium.PolylineDashMaterialProperty({
                color: col,
                dashLength: 32,
              });
            } else {
              e.polyline.material = col;
            }
            if (e.polyline.clampToGround) e.polyline.zIndex = 1;
          }

          if (e.polygon) {
            e.polygon.material = col.withAlpha(0.25);
            e.polygon.outline = true;
            e.polygon.outlineColor = col;
          }
        }
      }

      const isLabel = (e: any) => !!e.label;
      const isPin = (e: any) => !!(e.point || e.billboard);
      const isMinLine = (e: any) => e.polyline && (/\bmin\b/i.test(e.name || "") || hasProp(e, "minZ_m"));
      const isMaxLine = (e: any) => e.polyline && (/\bmax\b/i.test(e.name || "") || hasProp(e, "maxZ_m"));
      const isPlainVeinLine = (e: any) => !!e.polyline && !isMinLine(e) && !isMaxLine(e);

      function isSurfacePin(e: any) {
        if (!isPin(e)) return false;
        const n = (e.name || "").toLowerCase();
        return /(surface(line)?|pinsurface|pin\s*surface|surfaceline)/i.test(n) || hasProp(e, "surfaceZ_m");
      }

      function isMinPin(e: any) {
        if (!isPin(e)) return false;
        const n = (e.name || "").toLowerCase();
        return /\bmin\b/.test(n) || hasProp(e, "minZ_m");
      }

      function isMinMaxPinLike(e: any) {
        if (!(e.point || e.billboard || e.label)) return false;
        return /\b(min|max)\b/i.test(e.name || "");
      }

      function is3dDepth(e: any): boolean {
        const chk = (o: any) => {
          try {
            const p = o?.properties;
            const v = p?._3dDepth ?? p?._3dDeposit;
            return v && String(typeof v.getValue === "function" ? v.getValue() : v) === "true";
          } catch { return false; }
        };
        // Walk up the full parent chain (MultiGeometry can nest 2-3 levels)
        let node = e;
        for (let i = 0; i < 5 && node; i++) {
          if (chk(node)) return true;
          node = node.parent;
        }
        // Also check entity name patterns (separate Placemark naming convention)
        const n = (e.name || e.parent?.name || "").toLowerCase();
        return /deposit\s*volume|depth\s*column|min depth polygon|max depth polygon/i.test(n);
      }

      // Resolve commodity color by walking up the entity hierarchy
      function resolveDepositColor(e: any): any {
        // Walk parent chain looking for source property
        let node = e;
        for (let i = 0; i < 5 && node; i++) {
          try {
            const src = node.properties?.source;
            const srcVal = src ? String(typeof src.getValue === "function" ? src.getValue() : src) : "";
            if (srcVal && COMMODITY_COLOR[srcVal]) return COMMODITY_COLOR[srcVal];
          } catch { /* skip */ }
          // Check folder name
          const fname = node.name || "";
          for (const [key, col] of Object.entries(COMMODITY_COLOR)) {
            if (fname === key || new RegExp(`\\b${key}\\b`, "i").test(fname)) return col;
          }
          // Also match the folder color keys directly
          if (FOLDER_COLOR[fname]) return FOLDER_COLOR[fname];
          node = node.parent;
        }
        return null;
      }

      function drapePolygonToGround(pg: any, owner?: any) {
        const name = (owner?.name || "").toLowerCase();
        if (/\bmin depth polygon\b/.test(name) || /\bmax depth polygon\b/.test(name)) {
          return;
        }
        pg.height = undefined;
        pg.extrudedHeight = undefined;
        pg.perPositionHeight = false;
      }

      function hasDistinctPositions(pl: any, now: any, epsMeters = 0.01) {
        const pos = (pl.positions && pl.positions.getValue(now)) || [];
        if (!pos || pos.length < 2) return false;
        const p0 = pos[0];
        const p1 = pos[pos.length - 1];
        return Cesium.Cartesian3.distance(p0, p1) > epsMeters;
      }

      function sanitizePolyline(pl: any, now: any) {
        pl.arcType = Cesium.ArcType.GEODESIC;
        let w = 2.0;
        try {
          const wp = pl.width;
          w = Cesium.defined(wp) ? (wp.getValue ? wp.getValue(now) : Number(wp)) : 2.0;
        } catch {
          w = 2.0;
        }
        pl.width = Math.max(1.0, w || 2.0);
      }

      async function sampleTerrainHeight(cart: any) {
        try {
          const updated = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, [cart]);
          return updated[0]?.height ?? cart.height ?? 0;
        } catch {
          return cart.height ?? 0;
        }
      }

      async function buildColumnsByFolder() {
        for (const c of columnEntities) ds.entities.remove(c);
        columnEntities.length = 0;

        const radius = Number(rad?.value) || 0.8;

        const folders = new Map<string, { surf: any[]; min: any[] }>();
        for (const e of ds.entities.values) {
          const p = e.parent;
          if (!p || !p.name) continue;
          if (!folders.has(p.name)) folders.set(p.name, { surf: [], min: [] });
          const g = folders.get(p.name)!;
          if (isSurfacePin(e)) g.surf.push(e);
          else if (isMinPin(e)) g.min.push(e);
        }

        const now = Cesium.JulianDate.now();
        const cartoFromPin = (pin: any) => {
          const pos =
            (pin.position && (pin.position.getValue ? pin.position.getValue(now) : pin.position)) || pin.position;
          if (!pos) return null;
          return Cesium.Cartographic.fromCartesian(pos);
        };

        for (const [, group] of folders.entries()) {
          if (!group.surf.length || !group.min.length) continue;

          for (const s of group.surf) {
            const cs = cartoFromPin(s);
            if (!cs) continue;

            const topH = await sampleTerrainHeight(new Cesium.Cartographic(cs.longitude, cs.latitude, 0));

            let best: any = null;
            let bestD = Infinity;
            let cmBest: any = null;
            for (const m of group.min) {
              const cm = cartoFromPin(m);
              if (!cm) continue;
              const d = Math.hypot(cm.longitude - cs.longitude, cm.latitude - cs.latitude);
              if (d < bestD) {
                bestD = d;
                best = m;
                cmBest = cm;
              }
            }
            if (!best || !cmBest) continue;

            const botH = cmBest.height;
            if (!isFinite(topH) || !isFinite(botH) || Math.abs(topH - botH) < 0.05) continue;

            const midH = (topH + botH) * 0.5;
            const pos = Cesium.Cartesian3.fromRadians(cs.longitude, cs.latitude, midH);

            const ent = ds.entities.add({
              name: "Depth column",
              position: pos,
              orientation: Cesium.Transforms.headingPitchRollQuaternion(pos, new Cesium.HeadingPitchRoll(0, 0, 0)),
              cylinder: {
                length: Math.abs(topH - botH),
                topRadius: radius,
                bottomRadius: radius,
                material: COLUMN_COLOR,
                numberOfVerticalLines: 0,
              },
            });
            ent.parent = s.parent;
            columnEntities.push(ent);
          }
        }
      }

      function updateColumnRadius() {
        const r = Number(rad?.value) || 0.8;
        for (const c of columnEntities) {
          c.cylinder.topRadius = r;
          c.cylinder.bottomRadius = r;
        }
        viewer.scene.requestRender();
      }

      function folderVisibleMap() {
        return {
          Cu: !!chkCu?.checked,
          Au: !!chkAu?.checked,
          Oil: !!chkOil?.checked,
          H2O: !!chkWater?.checked,
          Gas: !!chkGas?.checked,
          Void: !!chkVoid?.checked,
        };
      }

      function applyVisibilityFilters() {
        if (!ds) return;
        const fvis = folderVisibleMap();

        for (const e of ds.entities.values) {
          const p = e.parent;
          const folderName = (p && p.name) || null;
          const inFolder =
            folderName && Object.prototype.hasOwnProperty.call(fvis, folderName)
              ? (fvis as any)[folderName]
              : true;

          const isVein = isPlainVeinLine(e);
          const isMin = isMinLine(e);
          const isMax = isMaxLine(e);
          const isCol = !!e.cylinder;
          const pinEnt = isPin(e);
          const labEnt = isLabel(e);

          let base = inFolder;
          if (isVein) base = base && !!chkSurf?.checked;
          if (isMin) base = base && !!chkMin?.checked;
          if (isMax) base = base && !!chkMax?.checked;
          if (isCol) base = base && !!chkCol?.checked;

          if (pinEnt || labEnt) {
            e.show = inFolder;
            if (e.point) e.point.show = new Cesium.ConstantProperty(!!chkPins?.checked);
            if (e.billboard) e.billboard.show = new Cesium.ConstantProperty(!!chkPins?.checked);
            if (e.label) {
              const isMinMax = isMinLine(e) || isMaxLine(e) || isMinPin(e) || isMinMaxPinLike(e);
              const showLabel = !!chkLabels?.checked && !isMinMax;
              e.label.show = new Cesium.ConstantProperty(showLabel);
            }
            if (e.polyline) e.polyline.show = new Cesium.ConstantProperty(!!base);
            if (e.polygon) e.polygon.show = new Cesium.ConstantProperty(!!base);
          } else {
            e.show = !!base;
          }
        }
        viewer.scene.requestRender();
      }

      async function applyAll() {
        ["Cu", "Au", "Oil", "H2O", "Gas", "Void"].forEach((n) => colorizeFolder(ds, n));

        // Detect which resource folders are actually present in the data
        const presentFolders = new Set<string>();
        for (const e of ds.entities.values) {
          const folder = e.parent?.name;
          if (folder && folder in FOLDER_COLOR) presentFolders.add(folder);
        }
        // Show/hide resource checkboxes based on what's present
        const chkMap: Record<string, HTMLInputElement | null> = {
          Cu: chkCu, Au: chkAu, Oil: chkOil, H2O: chkWater, Gas: chkGas, Void: chkVoid,
        };
        for (const [key, chk] of Object.entries(chkMap)) {
          const lbl = chk?.closest("label") as HTMLElement | null;
          if (lbl) lbl.style.display = presentFolders.has(key) ? "" : "none";
        }
        // Hide the entire resources row if no resources detected
        const resourcesRow = document.getElementById("resourcesRow");
        if (resourcesRow) resourcesRow.style.display = presentFolders.size > 0 ? "" : "none";

        const now = Cesium.JulianDate.now();

        for (const e of ds.entities.values) {
          if (e.polygon) {
            if (is3dDepth(e)) {
              // Preserve 3D volume geometry — force per-position heights
              e.polygon.perPositionHeight = true;
              e.polygon.heightReference = Cesium.HeightReference.NONE;

              // Color by commodity with transparency so we can see through
              const depColor = resolveDepositColor(e) || Cesium.Color.MAGENTA;
              e.polygon.material = depColor.withAlpha(DEPOSIT_ALPHA);
              e.polygon.outline = true;
              e.polygon.outlineColor = depColor.withAlpha(0.8);
              continue;
            }
            const hasExtruded =
              e.polygon.extrudedHeight &&
              (e.polygon.extrudedHeight.getValue?.(now) ?? e.polygon.extrudedHeight) !== undefined;
            if (!hasExtruded) drapePolygonToGround(e.polygon, e);
          }
        }

        for (const e of ds.entities.values) {
          if (isPlainVeinLine(e) && e.polyline) {
            if (hasDistinctPositions(e.polyline, now)) {
              sanitizePolyline(e.polyline, now);
              e.polyline.clampToGround = true;
              e.polyline.zIndex = 1;
            } else {
              e.polyline.clampToGround = false;
            }
          }
        }

        for (const e of ds.entities.values) {
          if (is3dDepth(e)) continue;
          if (e.point) e.point.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
          if (e.billboard) {
            e.billboard.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
            e.billboard.disableDepthTestDistance = Number.POSITIVE_INFINITY;
          }
          if (e.label) e.label.heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
        }

        await buildColumnsByFolder();
        applyVisibilityFilters();

        const a = Math.max(0, Math.min(100, Number(alpha?.value) || 40)) / 100;
        viewer.scene.globe.translucency.frontFaceAlpha = a;
        viewer.scene.requestRender();
      }

      async function flyCloserToDataSource(dsLocal: any) {
        try {
          viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        } catch {
          // noop
        }
        try {
          (viewer as any).__resetOrbitState?.();
        } catch {
          // noop
        }

        await new Promise((r) => requestAnimationFrame(r));

        const now = Cesium.JulianDate.now();
        const pts: any[] = [];

        for (const e of dsLocal.entities.values) {
          const p = e.position?.getValue ? e.position.getValue(now) : e.position;
          if (p) pts.push(p);

          if (e.polyline?.positions) {
            const arr = e.polyline.positions.getValue?.(now) ?? e.polyline.positions;
            if (Array.isArray(arr)) pts.push(...arr);
          }

          if (e.polygon?.hierarchy) {
            const hier = e.polygon.hierarchy.getValue?.(now) ?? e.polygon.hierarchy;
            const posArr = hier?.positions || hier?._positions || hier?.getValue?.(now)?.positions;
            if (Array.isArray(posArr) && posArr.length) pts.push(...posArr);
          }
        }

        if (!pts.length) {
          try {
            await viewer.flyTo(dsLocal, { duration: 1.2 });
          } catch {
            // noop
          }
          viewer.scene.requestRender();
          return;
        }

        const bs = Cesium.BoundingSphere.fromPoints(pts);

        // Compute center on the surface (ignore underground skew)
        const centerCart = Cesium.Cartographic.fromCartesian(bs.center);
        centerCart.height = 0; // project to ground level
        const surfaceCenter = Cesium.Cartesian3.fromRadians(
          centerCart.longitude, centerCart.latitude, 0
        );
        const surfaceBs = new Cesium.BoundingSphere(surfaceCenter, bs.radius);

        const clearMult = 0.65;
        const range = Math.max(10, surfaceBs.radius * (1 + clearMult));

        // Look straight down at center of the area
        const offset = new Cesium.HeadingPitchRange(0.0, -Math.PI / 2, range);
        await viewer.camera.flyToBoundingSphere(surfaceBs, {
          offset,
          duration: 1.2,
        });

        viewer.scene.requestRender();
      }

      function emitSummary(dsLocal: any, fileName: string) {
        const now = Cesium.JulianDate.now();
        const folderSet = new Set<string>();
        const entities: GeoEntity[] = [];

        for (const e of dsLocal.entities.values) {
          const folder = e.parent?.name || "(root)";
          folderSet.add(folder);

          let type: GeoEntity["type"] = "other";
          if (e.point || e.billboard) type = "point";
          else if (e.polyline) type = "polyline";
          else if (e.polygon) type = "polygon";
          else if (e.label) type = "label";

          const props: Record<string, string | number> = {};
          if (e.properties) {
            const names = e.properties.propertyNames || [];
            for (const pn of names) {
              try {
                const raw = e.properties[pn]?.getValue?.(now) ?? e.properties[pn];
                if (raw != null) props[pn] = typeof raw === "number" ? raw : String(raw);
              } catch { /* skip */ }
            }
          }

          entities.push({ name: e.name || "(unnamed)", folder, type, properties: props });
        }

        // Build compact text for LLM (cap at ~6k chars)
        const lines: string[] = [
          `File: ${fileName}`,
          `Folders: ${[...folderSet].join(", ")}`,
          `Total entities: ${entities.length}`,
          "",
        ];

        const byFolder = new Map<string, typeof entities>();
        for (const ent of entities) {
          if (!byFolder.has(ent.folder)) byFolder.set(ent.folder, []);
          byFolder.get(ent.folder)!.push(ent);
        }

        for (const [folder, ents] of byFolder) {
          lines.push(`## Folder: ${folder} (${ents.length} entities)`);
          // Show up to 30 entities per folder for context
          for (const ent of ents.slice(0, 30)) {
            const propStr = Object.entries(ent.properties)
              .map(([k, v]) => `${k}=${v}`)
              .join(", ");
            lines.push(`  - [${ent.type}] ${ent.name}${propStr ? " | " + propStr : ""}`);
          }
          if (ents.length > 30) lines.push(`  ... and ${ents.length - 30} more`);
          lines.push("");
        }

        let llmContext = lines.join("\n");
        if (llmContext.length > 6000) llmContext = llmContext.slice(0, 5950) + "\n... (truncated)";

        const summary: GeoFileSummary = {
          fileName,
          folderNames: [...folderSet],
          entityCount: entities.length,
          entities,
          llmContext,
        };
        setSummary(summary);
      }

      async function loadFromFile(file: File) {
        if (!file) return;
        if (ds) viewer.dataSources.remove(ds, true);

        const name = (file.name || "upload").toLowerCase();

        const loadKmlXml = async (xml: Document, sourceName: string) => {
          ds = await Cesium.KmlDataSource.load(xml, {
            camera: viewer.scene.camera,
            canvas: viewer.scene.canvas,
            clampToGround: false,
            sourceUri: `local:///${sourceName}`,
          });
          viewer.dataSources.add(ds);
          if (ds.readyPromise) await ds.readyPromise;

          await applyAll();
          await flyCloserToDataSource(ds);
          emitSummary(ds, sourceName);

          if (btnLoad) btnLoad.disabled = false;
        };

        const statusEl = document.getElementById("uploadStatus");
        const setStatus = (msg: string) => {
          if (statusEl) statusEl.textContent = msg;
        };

        const loadServerKml = async (kmlText: string, sourceName: string) => {
          // Parse and load the server-processed KML the same way client-side works
          const xml = new DOMParser().parseFromString(kmlText, "application/xml");
          await loadKmlXml(xml, sourceName);
        };

        try {
          if (name.endsWith(".kml") || name.endsWith(".kmz")) {
            // Server-side 3D transform via kmz-converter
            setStatus("Uploading & converting to 3D (DEM elevations)…");
            const form = new FormData();
            form.append("file", file);
            // Attach userId if a registered user is logged in
            const rootEl = document.getElementById("cesiumContainer")?.parentElement;
            const uid = rootEl?.dataset?.userId || "";
            if (uid) form.append("userId", uid);

            let serverOk = false;
            try {
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 120000); // 2 min max
              const resp = await fetch("/api/convert3d", { method: "POST", body: form, signal: controller.signal });
              clearTimeout(timeout);
              if (resp.ok) {
                const kmlText = await resp.text();
                console.log("[3D Convert] Server returned", kmlText.length, "chars of KML");
                setStatus("Loading 3D data into viewer…");
                await loadServerKml(kmlText, file.name);
                setStatus("3D conversion complete ✓");
                serverOk = true;
              } else {
                const errBody = await resp.json().catch(() => ({ error: "unknown" }));
                console.warn("[3D Convert] Server error:", resp.status, errBody.error);
                setStatus("Server transform failed – using client fallback…");
              }
            } catch (networkErr) {
              console.warn("[3D Convert] Network error, falling back to client transform:", networkErr);
              setStatus("Server unreachable – using client fallback…");
            }

            // Fallback: client-side regex transform
            if (!serverOk) {
              let kmlText: string;
              if (name.endsWith(".kmz")) {
                const JSZipLib = await waitForGlobal("JSZip", 8000);
                if (!JSZipLib) { console.error("[KMZ] JSZip not available"); return; }
                const ab = await readAsArrayBuffer(file);
                const zip = await JSZipLib.loadAsync(ab);
                const kmlPath = Object.keys(zip.files).find((p: string) => p.toLowerCase().endsWith(".kml")) || "";
                if (!kmlPath) { console.error("[KMZ] No .kml found inside KMZ"); return; }
                kmlText = await zip.file(kmlPath).async("text");
              } else {
                kmlText = await readAsText(file);
              }
              const kml3d = transformKmlFor3D(kmlText);
              const xml = new DOMParser().parseFromString(kml3d, "application/xml");
              await loadKmlXml(xml, file.name);
              setStatus("Loaded (client-side 3D fallback)");
            }
            return;
          }

          ds = await Cesium.KmlDataSource.load(file, {
            camera: viewer.scene.camera,
            canvas: viewer.scene.canvas,
            clampToGround: false,
            sourceUri: `local:///${file.name || "upload"}`,
          });
          viewer.dataSources.add(ds);
          if (ds.readyPromise) await ds.readyPromise;

          await applyAll();
          await flyCloserToDataSource(ds);
          emitSummary(ds, file.name || "upload");

          if (btnLoad) btnLoad.disabled = false;
        } catch (err) {
          console.error("[KMZ] load failed:", err);
          setStatus("Load failed – see console");
        }
      }

      up?.addEventListener("change", async () => {
        const file = up.files?.[0];
        if (!file) return;
        lastFile = file;
        await loadFromFile(file);
      });

      if (btnLoad) {
        btnLoad.disabled = true;
        btnLoad.addEventListener("click", async () => {
          if (!lastFile) return;
          await loadFromFile(lastFile);
        });
      }

      [
        chkCu,
        chkAu,
        chkOil,
        chkWater,
        chkGas,
        chkVoid,
        chkLabels,
        chkPins,
        chkSurf,
        chkMin,
        chkMax,
        chkCol,
      ].forEach((el) =>
        el?.addEventListener("change", () => {
          if (ds) applyVisibilityFilters();
        }),
      );

      alpha?.addEventListener("input", () => {
        const a = Math.max(0, Math.min(100, Number(alpha?.value) || 40)) / 100;
        viewer.scene.globe.translucency.frontFaceAlpha = a;
        viewer.scene.requestRender();
      });

      rad?.addEventListener("input", () => updateColumnRadius());

      (function droneJoysticks() {
        const css = `
.dj-wrap{position:absolute;z-index:1001;touch-action:none;user-select:none;pointer-events:none}
.dj-left{left:16px;bottom:16px;transform:translate(50px, -50px)}
.dj-right{right:16px;bottom:16px;transform:translate(-50px, -50px)}
.dj-pad{width:140px;height:140px;border-radius:50%;
  background: radial-gradient(ellipse at center,#111a 0%,#0006 65%,#0008 100%);
  border:1px solid #fff2; position:relative; box-shadow:0 6px 20px #0006 inset; pointer-events:auto}
.dj-ring{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:110px;height:110px;border-radius:50%;border:1px dashed #fff3}
.dj-cross{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);
  width:2px;height:100%;background:#fff2}
.dj-cross:after{content:"";position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(90deg);
  width:2px;height:100%;background:#fff2}
.dj-knob{width:52px;height:52px;border-radius:50%;
  background: radial-gradient(circle at 35% 35%,#fff9 0%,#ddd9 45%,#bbb9 100%);
  border:1px solid #0005; position:absolute;left:44px;top:44px; box-shadow:0 2px 10px #0008}
.dj-dir{position:absolute;font:9px system-ui;color:#fffc;text-shadow:0 1px 2px #000;white-space:nowrap}
.dj-dir-top{top:-18px;left:50%;transform:translateX(-50%)}
.dj-dir-bottom{bottom:-18px;left:50%;transform:translateX(-50%)}
.dj-dir-left{left:-4px;top:50%;transform:translate(-100%,-50%)}
.dj-dir-right{right:-4px;top:50%;transform:translate(100%,-50%)}
`;
        const style = document.createElement("style");
        style.textContent = css;
        document.head.appendChild(style);

        const host = rootRef.current || document.body;

        function makeStick(side: "left" | "right") {
          const wrap = document.createElement("div");
          wrap.className = `dj-wrap ${side === "left" ? "dj-left" : "dj-right"}`;

          const pad = document.createElement("div");
          pad.className = "dj-pad";
          const ring = document.createElement("div");
          ring.className = "dj-ring";
          const cross = document.createElement("div");
          cross.className = "dj-cross";
          const knob = document.createElement("div");
          knob.className = "dj-knob";

          if (side === "left") {
            const top = document.createElement("div");
            top.className = "dj-dir dj-dir-top";
            top.textContent = "Move Forward";
            const bottom = document.createElement("div");
            bottom.className = "dj-dir dj-dir-bottom";
            bottom.textContent = "Move Back";
            const left = document.createElement("div");
            left.className = "dj-dir dj-dir-left";
            left.textContent = "Move Left";
            const right = document.createElement("div");
            right.className = "dj-dir dj-dir-right";
            right.textContent = "Move Right";
            pad.appendChild(top);
            pad.appendChild(bottom);
            pad.appendChild(left);
            pad.appendChild(right);
          } else {
            const top = document.createElement("div");
            top.className = "dj-dir dj-dir-top";
            top.textContent = "Flight Up";
            const bottom = document.createElement("div");
            bottom.className = "dj-dir dj-dir-bottom";
            bottom.textContent = "Flight Down";
            const left = document.createElement("div");
            left.className = "dj-dir dj-dir-left";
            left.textContent = "Spin Left";
            const right = document.createElement("div");
            right.className = "dj-dir dj-dir-right";
            right.textContent = "Spin Right";
            pad.appendChild(top);
            pad.appendChild(bottom);
            pad.appendChild(left);
            pad.appendChild(right);
          }

          pad.appendChild(ring);
          pad.appendChild(cross);
          pad.appendChild(knob);
          wrap.appendChild(pad);
          host.appendChild(wrap);
          return { wrap, pad, knob };
        }

        const L = makeStick("left");
        const R = makeStick("right");

        const state = {
          left: { active: false, x: 0, y: 0 },
          right: { active: false, x: 0, y: 0 },
        };

        const PAD = 140;
        const KN = 52;
        const RADIUS = (PAD - KN) / 2;
        const BASE_DEAD = 0.08;
        const BASE_DAMP = 0.22;
        const BASE_STRAFE = 18.0;

        const js = () => (window as any).__joystickSettings || {};
        const getDead = () => js().deadZone ?? BASE_DEAD;
        const getDamp = () => js().damping ?? BASE_DAMP;
        const clampDead = (v: number) => (Math.abs(v) < getDead() ? 0 : v);

        const ORBIT: { pivot: any; range: number } = {
          pivot: null,
          range: 1000,
        };

        function getScreenCenterPivot() {
          const s = viewer.scene;
          const c = viewer.camera;
          const center = new Cesium.Cartesian2(s.drawingBufferWidth / 2, s.drawingBufferHeight / 2);
          const ray = c.getPickRay(center);
          let hit = Cesium.defined(ray) ? s.globe.pick(ray, s) : null;
          if (!hit) {
            const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(c.positionWC);
            const ahead = Cesium.Cartesian3.add(
              c.positionWC,
              Cesium.Cartesian3.multiplyByScalar(
                Cesium.Cartesian3.normalize(c.directionWC, new Cesium.Cartesian3()),
                Math.max(50, carto?.height || 500),
              ),
              new Cesium.Cartesian3(),
            );
            hit = ahead;
          }
          return hit;
        }

        function ensureOrbitTarget() {
          if (!ORBIT.pivot) {
            ORBIT.pivot = getScreenCenterPivot();
            ORBIT.range = Cesium.Cartesian3.distance(viewer.camera.positionWC, ORBIT.pivot);
          }
        }

        function clearOrbitTarget() {
          ORBIT.pivot = null;
        }

        function resetOrbitState() {
          ORBIT.pivot = null;
          try {
            viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
          } catch {
            // noop
          }
        }
        (viewer as any).__resetOrbitState = resetOrbitState;

        function clampPitch(p: number) {
          const min = Cesium.Math.toRadians(-89.0);
          const max = Cesium.Math.toRadians(89.0);
          return Cesium.Math.clamp(p, min, max);
        }

        function rotationScaleFromHeight() {
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(viewer.camera.positionWC);
          const h = Math.max(1, carto ? Math.max(carto.height || 0, 0) : 0);
          return Cesium.Math.clamp(1 / Math.pow(h / 1200, 0.55), 0.18, 1.8);
        }

        function camHeightMeters() {
          const carto = Cesium.Ellipsoid.WGS84.cartesianToCartographic(viewer.camera.positionWC);
          return carto ? Math.max(0, carto.height || 0) : 0;
        }

        function joystickScales() {
          const h = camHeightMeters();
          const hk = Math.max(1, h / 1000);
          const moveScale = Cesium.Math.clamp(hk, 0.2, 200);
          const zoomStep = Cesium.Math.clamp(h * 0.02, 2, 5000);
          return { moveScale, zoomStep };
        }

        function hook(stick: any, which: "left" | "right") {
          const { pad, knob } = stick;
          let snapBackId: number | null = null;
          let activePointerId: number | null = null;

          const center = () => {
            knob.style.left = `${PAD / 2 - KN / 2}px`;
            knob.style.top = `${PAD / 2 - KN / 2}px`;
          };
          center();

          const local = (e: any) => {
            const p = e.touches ? e.touches[0] : e;
            const r = pad.getBoundingClientRect();
            return {
              x: p.clientX - (r.left + r.width / 2),
              y: p.clientY - (r.top + r.height / 2),
            };
          };

          const clamp = (x: number, y: number) => {
            const d = Math.hypot(x, y);
            if (d > RADIUS) {
              const s = RADIUS / d;
              x *= s;
              y *= s;
            }
            return { x, y };
          };

          const setKnob = (x: number, y: number) => {
            knob.style.left = `${PAD / 2 - KN / 2 + x}px`;
            knob.style.top = `${PAD / 2 - KN / 2 + y}px`;
          };

          const stopSnapBack = () => {
            if (snapBackId != null) {
              clearInterval(snapBackId);
              snapBackId = null;
            }
          };

          const startSnapBack = () => {
            stopSnapBack();
            snapBackId = window.setInterval(() => {
              const d = getDamp();
              state[which].x *= 1 - d;
              state[which].y *= 1 - d;
              setKnob(state[which].x * RADIUS, state[which].y * RADIUS);
              if (Math.hypot(state[which].x, state[which].y) < 0.01) {
                state[which].x = 0;
                state[which].y = 0;
                center();
                stopSnapBack();
                if (which === "right") resetOrbitState();
              }
            }, 16);
          };

          const forceRelease = () => {
            activePointerId = null;
            state[which].active = false;
            startSnapBack();
          };

          function start(e: any) {
            if (activePointerId != null) return;
            activePointerId = e.pointerId ?? null;
            state[which].active = true;
            stopSnapBack();
            e.stopPropagation?.();
            if (e.pointerId != null && pad.setPointerCapture) {
              try {
                pad.setPointerCapture(e.pointerId);
              } catch {
                // noop
              }
            }
            move(e);
            e.preventDefault();
          }

          function move(e: any) {
            if (!state[which].active) return;
            if (e.pointerId != null && activePointerId != null && e.pointerId !== activePointerId) return;
            e.stopPropagation?.();
            const p = local(e);
            const c = clamp(p.x, p.y);
            state[which].x = c.x / RADIUS;
            state[which].y = c.y / RADIUS;
            setKnob(c.x, c.y);
            e.preventDefault();
          }

          function end(e?: any) {
            if (e?.pointerId != null && activePointerId != null && e.pointerId !== activePointerId) return;
            activePointerId = null;
            state[which].active = false;
            startSnapBack();
          }

          pad.addEventListener("pointerdown", start);
          pad.addEventListener("lostpointercapture", () => forceRelease());
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end);
          window.addEventListener("pointercancel", end);

          pad.addEventListener("touchstart", (e: any) => {
            if (state[which].active) return;
            start(e);
          }, { passive: false });
          window.addEventListener("touchmove", move, {
            passive: false,
          });
          window.addEventListener("touchend", () => {
            if (activePointerId == null) end();
          });
          window.addEventListener("touchcancel", () => {
            if (activePointerId == null) end();
          });

          window.addEventListener("blur", () => forceRelease());
          document.addEventListener("visibilitychange", () => {
            if (document.hidden) forceRelease();
          });
        }

        hook(L, "left");
        hook(R, "right");

        (function mouseToState() {
          const canvas: HTMLCanvasElement = viewer.scene.canvas;
          if (!canvas) return;

          try {
            const s = viewer.scene.screenSpaceCameraController;
            s.enableRotate = false;
            s.enableTranslate = false;
            s.enableZoom = false;
            s.enableTilt = false;
            s.enableLook = false;
          } catch {
            // noop
          }

          canvas.addEventListener("contextmenu", (e) => e.preventDefault());

          let dragging: null | "left" | "right" = null;
          let lastX = 0;
          let lastY = 0;

          const clamp01 = (v: number) => Math.max(-1, Math.min(1, v));
          const PX_TO_UNIT_LEFT_BASE = 1 / 70;
          const PX_TO_UNIT_RIGHT_BASE = 1 / 90;

          const end = () => {
            if (dragging === "left") {
              state.left.active = false;
              state.left.x = 0;
              state.left.y = 0;
            } else if (dragging === "right") {
              state.right.active = false;
              state.right.x = 0;
              state.right.y = 0;
              resetOrbitState();
            }
            dragging = null;
          };

          canvas.addEventListener(
            "pointerdown",
            (e) => {
              const isRight = e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey));

              dragging = isRight ? "right" : "left";
              lastX = e.clientX;
              lastY = e.clientY;

              if (dragging === "left") state.left.active = true;
              else state.right.active = true;

              try {
                canvas.setPointerCapture(e.pointerId);
              } catch {
                // noop
              }

              e.preventDefault();
              e.stopPropagation();
            },
            { passive: false },
          );

          canvas.addEventListener(
            "pointermove",
            (e) => {
              if (!dragging) return;

              const dx = e.clientX - lastX;
              const dy = e.clientY - lastY;
              lastX = e.clientX;
              lastY = e.clientY;

              if (dragging === "left") {
                const mSens = js().mouseSensitivity ?? 1.0;
                state.left.x = clamp01(state.left.x + dx * PX_TO_UNIT_LEFT_BASE * mSens);
                state.left.y = clamp01(state.left.y + dy * PX_TO_UNIT_LEFT_BASE * mSens);

                try {
                  clearOrbitTarget();
                  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
                } catch {
                  // noop
                }
              } else {
                const mSens = js().mouseSensitivity ?? 1.0;
                state.right.x = clamp01(state.right.x + dx * PX_TO_UNIT_RIGHT_BASE * mSens);
                state.right.y = clamp01(state.right.y + dy * PX_TO_UNIT_RIGHT_BASE * mSens);
              }

              e.preventDefault();
              e.stopPropagation();
            },
            { passive: false },
          );

          canvas.addEventListener(
            "pointerup",
            (e) => {
              end();
              e.preventDefault();
              e.stopPropagation();
            },
            { passive: false },
          );
          canvas.addEventListener(
            "pointercancel",
            (e) => {
              end();
              e.preventDefault();
              e.stopPropagation();
            },
            { passive: false },
          );

          window.addEventListener("blur", end);
        })();

        function driveOnce() {
          let moved = false;
          let movedLeft = false;
          const { moveScale, zoomStep } = joystickScales();

          if (state.left.active || state.left.x || state.left.y) {
            const x = clampDead(state.left.x);
            const y = clampDead(state.left.y);

            if (x) {
              const mSpeed = js().moveSpeed ?? 1.0;
              const m = BASE_STRAFE * moveScale * Math.abs(x) * mSpeed;
              if (x < 0) viewer.camera.moveLeft(m);
              else viewer.camera.moveRight(m);
              moved = true;
              movedLeft = true;
            }

            if (y) {
              const zSpeed = js().zoomSpeed ?? 1.0;
              const z = zoomStep * Math.abs(y) * zSpeed;
              if (y < 0) viewer.camera.zoomIn(z);
              else viewer.camera.zoomOut(z);
              ORBIT.range = Math.max(5, ORBIT.range + (y < 0 ? -z : z));
              moved = true;
              movedLeft = true;
            }
          }

          if (movedLeft) {
            clearOrbitTarget();
            try {
              viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
            } catch {
              // noop
            }
          }

          if (state.right.active || state.right.x || state.right.y) {
            ensureOrbitTarget();
            const x = clampDead(state.right.x);
            const y = clampDead(state.right.y);

            if (x || y) {
              const rot = rotationScaleFromHeight();
              const rSpeed = js().rotateSpeed ?? 1.0;
              const YAW_SPEED = 0.008 * rSpeed;
              const PITCH_SPEED = 0.008 * rSpeed;
              const invertY = js().invertY ?? false;

              const dh = -x * YAW_SPEED * rot;
              const dp = (invertY ? -y : y) * PITCH_SPEED * rot;

              const c = viewer.camera;
              const heading = c.heading + dh;
              const pitch = clampPitch(c.pitch + dp);

              c.lookAt(ORBIT.pivot, new Cesium.HeadingPitchRange(heading, pitch, ORBIT.range));
              moved = true;
            }
          }

          if (moved) viewer.scene.requestRender();
        }

        joystickInterval = window.setInterval(driveOnce, 1000 / 30);
      })();
    }

    initWhenReady();

    return () => {
      window.removeEventListener("resize", onResize);
      if (joystickInterval) clearInterval(joystickInterval);
      (rootNode || document).querySelectorAll(".dj-wrap").forEach((n) => n.remove());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSummary]);

  // Keep userId in sync on the root element so the inline upload handler can read it
  useEffect(() => {
    const el = rootRef.current;
    if (el) el.dataset.userId = user?.id || "";
  }, [user]);

  return (
    <div ref={rootRef} style={{ width: "100%", height: "100%", position: "relative" }}>
      <div
        ref={containerRef}
        id="cesiumContainer"
        style={{ position: "absolute", inset: 0, zIndex: 0, width: "100%", height: "100%" }}
      />

      <div
        id="toolbar"
        className="geo-toolbar"
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10000,
          pointerEvents: "auto",
          background: "#000c",
          borderRadius: 8,
          padding: "8px 10px",
          font: "14px/1.2 system-ui,sans-serif",
          color: "#fff",
          border: "1px solid #444",
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          id="toggleToolbar"
          style={{
            position: "absolute",
            top: 8,
            right: 10,
            zIndex: 1100,
            background: "#222",
            color: "#fff",
            border: "1px solid #555",
            borderRadius: 4,
            padding: "3px 8px",
            font: "12px system-ui,sans-serif",
            cursor: "pointer",
          }}
          onClick={(e) => {
            e.stopPropagation();
            const tb = document.getElementById("toolbar");
            const table = tb?.querySelector("table") as HTMLTableElement | null;
            if (!tb || !table) return;

            const showing = table.style.display === "none";
            table.style.display = showing ? "table" : "none";
            (e.target as HTMLButtonElement).textContent = showing ? "Hide" : "Show";

            tb.style.background = showing ? "#000c" : "transparent";
            tb.style.border = showing ? "1px solid #444" : "none";
            tb.style.padding = showing ? "8px 10px" : "4px 10px";
          }}
        >
          Hide
        </button>

        <table>
          <tbody>
            <tr>
              <td>
                <input
                  id="uploader"
                  type="file"
                  accept=".kmz,.kml"
                  style={{
                    marginBottom: 8,
                    color: "#fff",
                    position: "relative",
                    zIndex: 10001,
                    pointerEvents: "auto",
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <button
                  id="btnLoad"
                  style={{
                    marginLeft: 8,
                    padding: "4px 12px",
                    background: "#fff",
                    color: "#000",
                    border: "1px solid #555",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  Reload
                </button>
                <div
                  id="uploadStatus"
                  style={{
                    marginTop: 6,
                    fontSize: 12,
                    color: "#4fc3f7",
                    minHeight: 16,
                  }}
                />
              </td>
            </tr>

            <tr>
              <td>
                <div id="resourcesRow" style={{ borderBottom: "1px solid #444", paddingBottom: 6, marginBottom: 2, display: "none" }}>
                  <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Resources</div>
                  <label>
                    <span style={sw("#B87333")} /> Cu <input id="chkCu" type="checkbox" defaultChecked />
                  </label>
                  <label>
                    <span style={sw("#FFD700")} /> Au <input id="chkAu" type="checkbox" defaultChecked />
                  </label>
                  <label>
                    <span style={sw("#000000")} /> Oil <input id="chkOil" type="checkbox" defaultChecked />
                  </label>
                  <label>
                    <span style={sw("#4A86FF")} /> H2O <input id="chkWater" type="checkbox" defaultChecked />
                  </label>
                  <label>
                    <span style={sw("#6EA8A3")} /> Gas <input id="chkGas" type="checkbox" defaultChecked />
                  </label>
                  <label>
                    <span style={sw("#7BE134")} /> Void <input id="chkVoid" type="checkbox" defaultChecked />
                  </label>
                </div>
              </td>
            </tr>

            <tr>
              <td>
                <div style={{ borderBottom: "1px solid #444", paddingBottom: 6, marginBottom: 2 }}>
                  <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Display</div>
                  <label>
                    <input id="chkLabels" type="checkbox" defaultChecked /> Labels
                  </label>
                  <label>
                    <input id="chkPins" type="checkbox" defaultChecked /> Pins
                  </label>
                  <label>
                    <input id="chkSurf" type="checkbox" defaultChecked /> Vein Line
                  </label>
                  <label>
                    <input id="chkMin" type="checkbox" defaultChecked /> Min Line
                  </label>
                  <label>
                    <input id="chkMax" type="checkbox" defaultChecked /> Max Line
                  </label>
                  <label>
                    <input id="chkCol" type="checkbox" defaultChecked /> Columns
                  </label>
                </div>
              </td>
            </tr>

            <tr>
              <td>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Legend</div>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "10px 16px",
                    alignItems: "center",
                    marginTop: 6,
                  }}
                >
                  <LegendLine label="Vein (surface)" />
                  <LegendLine label="Min depth (underground)" under />
                  <LegendLine label="Max depth (dashed)" dashed />
                </div>
              </td>
            </tr>

            <tr>
              <td>
                <details id="settingsDetails" style={{ marginTop: 2 }}>
                  <summary style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, cursor: "pointer", userSelect: "none", padding: "4px 0" }}>
                    ⚙ Settings
                  </summary>
                  <div id="settingsBody" style={{ paddingTop: 6 }} />
                </details>
              </td>
            </tr>

            <tr>
              <td>
                <AccountSection />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sw(color: string): React.CSSProperties {
  return {
    display: "inline-block",
    width: 12,
    height: 12,
    border: "1px solid #fff6",
    marginRight: 6,
    verticalAlign: "middle",
    background: color,
  };
}

function LegendLine({ label, dashed, under }: { label: string; dashed?: boolean; under?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        color: "#ddd",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      <svg width="56" height={under ? 16 : 12} viewBox={under ? "0 0 56 16" : "0 0 56 12"} aria-hidden="true">
        {under && <line x1="2" y1="6" x2="54" y2="6" stroke="#666" strokeWidth="1" opacity="0.35" />}
        <line
          x1="2"
          y1={under ? 12 : 6}
          x2="54"
          y2={under ? 12 : 6}
          stroke="#bbb"
          strokeWidth="3"
          strokeDasharray={dashed ? "8 6" : undefined}
          opacity={under ? 0.6 : 1}
        />
      </svg>
      <span>{label}</span>
    </div>
  );
}

/* ── Account Section (inline in toolbar) ─────────────────────── */

type HistoryItem = {
  id: string;
  fileName: string;
  blobUrl: string;
  blobSize: number;
  createdAt: string;
};

function AccountSection() {
  const { user, setUser } = useGeoData();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const reset = () => {
    setEmail(""); setPassword(""); setFirstName(""); setLastName(""); setCompany(""); setError("");
  };

  const handleLogin = async () => {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Login failed"); return; }
      setUser(data.user as UserInfo);
      reset();
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  };

  const handleRegister = async () => {
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, firstName, lastName, company }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || "Registration failed"); return; }
      setUser(data.user as UserInfo);
      reset();
    } catch { setError("Network error"); }
    finally { setLoading(false); }
  };

  const loadHistory = useCallback(async () => {
    if (!user) return;
    setHistLoading(true);
    try {
      const res = await fetch(`/api/uploads?userId=${encodeURIComponent(user.id)}`);
      if (res.ok) { const d = await res.json(); setHistory(d.uploads || []); }
    } catch { /* ignore */ }
    setHistLoading(false);
  }, [user]);

  const logout = () => { setUser(null); reset(); setHistory([]); };

  const inputSt: React.CSSProperties = {
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(137,168,201,0.2)",
    borderRadius: 4, color: "#e7eef8", padding: "5px 7px", fontSize: 11,
    fontFamily: "system-ui", width: "100%", outline: "none",
  };

  const btnSt: React.CSSProperties = {
    background: "#2ea8ff", border: "none", borderRadius: 4,
    color: "#fff", padding: "5px 0", cursor: "pointer", fontSize: 11,
    fontFamily: "system-ui", width: "100%",
  };

  return (
    <details style={{ marginTop: 2 }}>
      <summary
        style={{
          fontSize: 10, color: "#888", textTransform: "uppercase",
          letterSpacing: 1, cursor: "pointer", userSelect: "none", padding: "4px 0",
        }}
      >
        👤 Account
      </summary>
      <div style={{ paddingTop: 6-0, display: "flex", flexDirection: "column", gap: 6 }}>
        {user ? (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "#ccc" }}>
                {user.firstName} {user.lastName}
              </span>
              <button onClick={logout} style={{ background: "none", border: "1px solid rgba(137,168,201,0.2)", borderRadius: 4, color: "#888", fontSize: 10, padding: "2px 6px", cursor: "pointer" }}>
                Logout
              </button>
            </div>

            {/* Upload history */}
            <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadHistory(); }}>
              <summary style={{ fontSize: 10, color: "#888", cursor: "pointer", userSelect: "none", padding: "2px 0" }}>
                📁 My Uploads
              </summary>
              <div style={{ maxHeight: 160, overflowY: "auto", marginTop: 4 }}>
                {histLoading && <p style={{ color: "#888", fontSize: 11, margin: 0 }}>Loading…</p>}
                {!histLoading && !history.length && <p style={{ color: "#888", fontSize: 11, margin: 0 }}>No uploads yet</p>}
                {history.map((it) => (
                  <div key={it.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#ccc" }}>{it.fileName}</div>
                      <div style={{ fontSize: 9, color: "#666" }}>{new Date(it.createdAt).toLocaleDateString()} · {(it.blobSize / 1024).toFixed(0)} KB</div>
                    </div>
                    <a href={it.blobUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#2ea8ff", fontSize: 12, textDecoration: "none" }}>⬇</a>
                  </div>
                ))}
              </div>
            </details>

            {/* Admin link */}
            <a href="/admin" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#888", textDecoration: "none", marginTop: 2 }}>
              🔒 Admin Panel
            </a>
          </>
        ) : (
          <>
            <div style={{ display: "flex", gap: 4, marginBottom: 2 }}>
              <button onClick={() => { setMode("login"); setError(""); }} style={{ flex: 1, background: mode === "login" ? "#2ea8ff" : "transparent", border: "1px solid rgba(137,168,201,0.2)", borderRadius: 4, color: mode === "login" ? "#fff" : "#888", fontSize: 10, padding: "3px 0", cursor: "pointer" }}>Login</button>
              <button onClick={() => { setMode("register"); setError(""); }} style={{ flex: 1, background: mode === "register" ? "#2ea8ff" : "transparent", border: "1px solid rgba(137,168,201,0.2)", borderRadius: 4, color: mode === "register" ? "#fff" : "#888", fontSize: 10, padding: "3px 0", cursor: "pointer" }}>Register</button>
            </div>
            {mode === "register" && (
              <>
                <input placeholder="First name *" value={firstName} onChange={(e) => setFirstName(e.target.value)} style={inputSt} />
                <input placeholder="Last name *" value={lastName} onChange={(e) => setLastName(e.target.value)} style={inputSt} />
                <input placeholder="Company" value={company} onChange={(e) => setCompany(e.target.value)} style={inputSt} />
              </>
            )}
            <input placeholder="Email *" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={inputSt} />
            <input
              placeholder="Password *" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (mode === "login" ? handleLogin() : handleRegister())}
              style={inputSt}
            />
            <button onClick={mode === "login" ? handleLogin : handleRegister} disabled={loading} style={btnSt}>
              {loading ? "…" : mode === "login" ? "Login" : "Create Account"}
            </button>
            {error && <p style={{ color: "#f66", margin: 0, fontSize: 11 }}>{error}</p>}

            {/* Admin link available even when logged out */}
            <a href="/admin" target="_blank" rel="noopener noreferrer" style={{ fontSize: 10, color: "#888", textDecoration: "none", marginTop: 2 }}>
              🔒 Admin Panel
            </a>
          </>
        )}
      </div>
    </details>
  );
}
