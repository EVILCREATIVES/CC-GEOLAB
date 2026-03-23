"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import * as React from "react";
import { useEffect, useRef } from "react";
import { useGeoData, type GeoEntity, type GeoFileSummary } from "@/context/GeoDataContext";

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

export default function CesiumKMZ() {
  const readyRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const { setSummary } = useGeoData();

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
        const clearMult = 0.65;
        const range = Math.max(10, bs.radius * (1 + clearMult));

        const offset = new Cesium.HeadingPitchRange(0.0, -0.35, range);
        await viewer.camera.flyToBoundingSphere(bs, {
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

        try {
          if (name.endsWith(".kml")) {
            const txt = await readAsText(file);
            const xml = new DOMParser().parseFromString(txt, "application/xml");
            await loadKmlXml(xml, file.name);
            return;
          }

          if (name.endsWith(".kmz")) {
            const JSZip = await waitForGlobal("JSZip", 8000);
            if (!JSZip) {
              console.error("[KMZ] JSZip not available");
              return;
            }

            const ab = await readAsArrayBuffer(file);
            const zip = await JSZip.loadAsync(ab);

            const kmlPath = Object.keys(zip.files).find((p) => p.toLowerCase().endsWith(".kml")) || "";

            if (!kmlPath) {
              console.error("[KMZ] No .kml found inside KMZ");
              return;
            }

            const kmlText = await zip.file(kmlPath).async("text");
            const xml = new DOMParser().parseFromString(kmlText, "application/xml");
            await loadKmlXml(xml, kmlPath);
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
              }
            }, 16);
          };

          function start(e: any) {
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
            e.stopPropagation?.();
            const p = local(e);
            const c = clamp(p.x, p.y);
            state[which].x = c.x / RADIUS;
            state[which].y = c.y / RADIUS;
            setKnob(c.x, c.y);
            e.preventDefault();
          }

          function end() {
            state[which].active = false;
            startSnapBack();
          }

          pad.addEventListener("pointerdown", start);
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", end);
          window.addEventListener("pointercancel", end);

          pad.addEventListener("touchstart", start, {
            passive: false,
          });
          window.addEventListener("touchmove", move, {
            passive: false,
          });
          window.addEventListener("touchend", end);
          window.addEventListener("touchcancel", end);

          window.addEventListener("blur", end);
          document.addEventListener("visibilitychange", () => {
            if (document.hidden) end();
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
