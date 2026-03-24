/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * KMZ 2D → 3D Converter  (TypeScript port of kmz_altitude_app.py)
 *
 * Takes a KMZ/KML, samples DEM elevations from OpenTopoData,
 * injects absolute altitudes, generates 3D depth structures,
 * and outputs a new KMZ.
 */

import JSZip from "jszip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import xpath from "xpath";

// ── Namespaces ─────────────────────────────────────────────────
const KML_NS = "http://www.opengis.net/kml/2.2";
const GX_NS = "http://www.google.com/kml/ext/2.2";

const select = xpath.useNamespaces({ kml: KML_NS, gx: GX_NS });

// ── Throttling constants ───────────────────────────────────────
const OPENTOPODATA_MIN_SLEEP_MS = 450;
const OPENTOPODATA_MAX_RETRIES = 7;
const OPENTOPODATA_CHUNK = 60;

// ── Types ──────────────────────────────────────────────────────
type Coord = [number, number, number | null]; // [lon, lat, alt]
type Coord3 = [number, number, number];

export interface ConvertOptions {
  mode: "absolute" | "relativeToGround" | "clampToGround";
  offsetM: number;
  datumOffsetM: number;
  useDepthFromNames: boolean;
  generateVolumePolygons: boolean;
}

// ── Helpers ────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function keyRound(lon: number, lat: number): string {
  return `${lon.toFixed(6)},${lat.toFixed(6)}`;
}

// ── ZIP I/O ────────────────────────────────────────────────────
export async function unzipKmzToKml(kmzBuf: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(kmzBuf);
  const names = Object.keys(zip.files);
  const kmlNames = names.filter((n) => n.toLowerCase().endsWith(".kml"));
  if (!kmlNames.length) throw new Error("KMZ does not contain a .kml file.");
  for (const cand of ["doc.kml", "Doc.kml", "KmlDocument.kml"]) {
    if (names.includes(cand)) return Buffer.from(await zip.files[cand].async("arraybuffer"));
  }
  return Buffer.from(await zip.files[kmlNames[0]].async("arraybuffer"));
}

export async function rezipKmlToKmz(kmlBuf: Buffer, originalKmz?: Buffer): Promise<Buffer> {
  const out = new JSZip();
  if (originalKmz) {
    const orig = await JSZip.loadAsync(originalKmz);
    for (const name of Object.keys(orig.files)) {
      if (!name.toLowerCase().endsWith(".kml")) {
        out.file(name, await orig.files[name].async("arraybuffer"));
      }
    }
  }
  out.file("doc.kml", kmlBuf);
  const buf = await out.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return buf;
}

// ── Depth parsing ──────────────────────────────────────────────
function toMeters(value: number, unit: string | null, defaultUnit = "m"): number {
  const u = (unit || defaultUnit).toLowerCase().trim();
  if (["m", "meter", "meters"].includes(u)) return value;
  if (["ft", "foot", "feet", "'"].includes(u)) return value * 0.3048;
  if (['"', "in", "inch", "inches"].includes(u)) return value * 0.0254;
  return value;
}

export function extractDepthRange(name: string, defaultUnit = "m"): [number, number] | null {
  if (!name) return null;
  const s = name.trim();

  let m = s.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*(m|ft|'|"|in|inch|inches))?\s*$/i);
  if (m) {
    const a = toMeters(parseFloat(m[1]), m[3], defaultUnit);
    const b = toMeters(parseFloat(m[2]), m[3], defaultUnit);
    return [Math.min(a, b), Math.max(a, b)];
  }

  m = s.match(/(\d+(?:\.\d+)?)(?:\s*(m|ft|'|"|in|inch|inches))\s*$/i);
  if (m) {
    const v = toMeters(parseFloat(m[1]), m[2], defaultUnit);
    return [v, v];
  }

  m = s.match(/(\d+(?:\.\d+)?)(?:\s*(m|ft|'|"|in|inch|inches))/i);
  if (m) {
    const v = toMeters(parseFloat(m[1]), m[2], defaultUnit);
    return [v, v];
  }

  return null;
}

// ── Pretty names ───────────────────────────────────────────────
const RANGE_RE = /(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)(?:\s*(m|ft|'|"))?/i;

function cleanBase(raw: string): string {
  let s = (raw || "").trim().replace(/[/\\]/g, " ");
  s = s.replace(/[\s,:;._-]+$/, "").trim();
  const m = s.match(/([A-Za-z0-9]+[A-Za-z]?)$/);
  return m ? m[1] : s || "Point";
}

function derivePrettyNames(pmName: string): [string, string, string, string] {
  const s = pmName || "Point";
  const m = RANGE_RE.exec(s);
  if (!m) {
    const base = cleanBase(s);
    return [`${base} surfaceline`, `${base} min depth`, `${base} max depth`, `${base} depth column`];
  }
  const [minTxt, maxTxt] = [m[1], m[2]];
  const base = cleanBase(s.slice(0, m.index));
  return [
    `${base} ${minTxt}-${maxTxt} surfaceline`,
    `${base} ${minTxt} min depth`,
    `${base} ${maxTxt} max depth`,
    `${base} ${minTxt}-${maxTxt} depth column`,
  ];
}

// ── Commodity detection ────────────────────────────────────────
const COMMODITY_PATTERNS: [RegExp, string][] = [
  [/\b(Au|Gold)\b/i, "Gold"],
  [/\b(Cu|Copper)\b/i, "Copper"],
  [/\b(Li|Lithium)\b/i, "Lithium"],
  [/\b(Ag|Silver)\b/i, "Silver"],
  [/(Oil\s*&?\s*Gas|Oil\s+and\s+Gas|Oil\b|Petroleum|Crude)/i, "Oil & Gas"],
  [/Buried\s*Treasure/i, "Buried Treasure"],
  [/(Ship\s*Wrecks?|Ship\s*Wreck\s*Treasure)/i, "Ship Wrecks"],
  [/(Ground\s*Water|Water\s*Table)/i, "Ground Water"],
  [/Explosives?/i, "Explosives"],
  [/(Ancient\s*Ruins?|Artifacts?)/i, "Ancient Ruins"],
];

function whichCommodity(name: string): string | null {
  if (!name) return null;
  for (const [rx, label] of COMMODITY_PATTERNS) {
    if (rx.test(name)) return label;
  }
  return null;
}

function isSurveyArea(name: string): boolean {
  return /\bSurvey\s*Area\b/i.test(name || "");
}

function isDeposit(name: string): boolean {
  return /\bdeposit\b/i.test(name || "");
}

function shouldSkipVolume(name: string): boolean {
  return /(verify\s*png|png\s*depth\s*volume)/i.test(name || "");
}

// ── Coordinate parsing ─────────────────────────────────────────
function parseCoords(text: string): Coord[] {
  if (!text) return [];
  const out: Coord[] = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const p = tok.split(",");
    if (p.length >= 2) {
      const lon = parseFloat(p[0]);
      const lat = parseFloat(p[1]);
      const alt = p.length > 2 && p[2] !== "" ? parseFloat(p[2]) : null;
      out.push([lon, lat, alt]);
    }
  }
  return out;
}

function formatCoords(coords: Coord3[]): string {
  return coords.map(([lon, lat, alt]) => `${lon.toFixed(8)},${lat.toFixed(8)},${alt.toFixed(3)}`).join(" ");
}

function formatCoords2D(coords: Coord[]): string {
  return coords.map(([lon, lat]) => `${lon.toFixed(8)},${lat.toFixed(8)}`).join(" ");
}

// ── DEM Elevation ──────────────────────────────────────────────
async function openTopoChunk(
  points: [number, number][],
  onProgress?: (msg: string) => void
): Promise<number[]> {
  const baseUrl = "https://api.opentopodata.org/v1/srtm30m";
  const locs = points.map(([lon, lat]) => `${lat},${lon}`).join("|");

  for (let attempt = 0; attempt < OPENTOPODATA_MAX_RETRIES; attempt++) {
    try {
      const url = `${baseUrl}?locations=${encodeURIComponent(locs)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        const backoff = 500 * Math.pow(2, attempt) + Math.random() * 400;
        onProgress?.(`DEM API ${res.status}, retrying in ${Math.round(backoff)}ms...`);
        await sleep(backoff);
        continue;
      }
      if (!res.ok) throw new Error(`OpenTopoData HTTP ${res.status}`);
      const data = await res.json();
      if (data.status !== "OK" || !data.results) throw new Error(`OpenTopoData bad response: ${JSON.stringify(data).slice(0, 200)}`);
      if (data.results.length !== points.length) throw new Error("OpenTopoData count mismatch");

      const elevs: number[] = [];
      for (let i = 0; i < points.length; i++) {
        const e = data.results[i].elevation;
        if (e == null) throw new Error(`Missing DEM at (${points[i][0].toFixed(6)}, ${points[i][1].toFixed(6)})`);
        elevs.push(e);
      }
      await sleep(OPENTOPODATA_MIN_SLEEP_MS);
      return elevs;
    } catch (err: any) {
      if (attempt === OPENTOPODATA_MAX_RETRIES - 1) throw new Error(`OpenTopoData failed after retries: ${err.message}`);
      const backoff = 500 * Math.pow(2, attempt) + Math.random() * 400;
      await sleep(backoff);
    }
  }
  throw new Error("OpenTopoData retry loop exited");
}

async function sampleElevations(
  points: [number, number][],
  demCache: Map<string, number>,
  onProgress?: (msg: string) => void
): Promise<number[]> {
  const needed: [number, number][] = [];
  for (const [lon, lat] of points) {
    if (!demCache.has(keyRound(lon, lat))) needed.push([lon, lat]);
  }
  for (let i = 0; i < needed.length; i += OPENTOPODATA_CHUNK) {
    const chunk = needed.slice(i, i + OPENTOPODATA_CHUNK);
    onProgress?.(`Fetching DEM elevations: ${i + chunk.length}/${needed.length}`);
    const elevs = await openTopoChunk(chunk, onProgress);
    for (let j = 0; j < chunk.length; j++) {
      demCache.set(keyRound(chunk[j][0], chunk[j][1]), elevs[j]);
    }
  }
  return points.map(([lon, lat]) => demCache.get(keyRound(lon, lat))!);
}

// ── XML helpers ────────────────────────────────────────────────
function kmlEl(doc: Document, tag: string, text?: string): Element {
  const el = doc.createElementNS(KML_NS, tag);
  if (text !== undefined) el.textContent = text;
  return el;
}

function gxEl(doc: Document, tag: string, text?: string): Element {
  const el = doc.createElementNS(GX_NS, `gx:${tag}`);
  if (text !== undefined) el.textContent = text;
  return el;
}

function findKml(ctx: Node, expr: string): Element[] {
  return select(expr, ctx) as Element[];
}

function findKmlOne(ctx: Node, expr: string): Element | null {
  const r = select(expr, ctx) as Element[];
  return r.length ? r[0] : null;
}

function getTextContent(el: Element, childTag: string): string {
  const child = findKmlOne(el, `kml:${childTag}`);
  return child?.textContent?.trim() || "";
}

function setAltitudeMode(elem: Element, mode: string) {
  const resolved = mode === "clampToGround" ? "absolute" : mode;
  // remove gx:altitudeMode
  for (const gx of findKml(elem, ".//gx:altitudeMode")) {
    gx.parentNode?.removeChild(gx);
  }
  // set or create kml:altitudeMode
  const existing = findKml(elem, ".//kml:altitudeMode");
  if (existing.length) {
    existing[0].textContent = resolved;
  } else {
    for (const tag of ["Point", "LineString", "LinearRing", "Polygon"]) {
      const geom = findKmlOne(elem, `.//kml:${tag}`);
      if (geom) {
        const am = kmlEl(geom.ownerDocument!, "altitudeMode", resolved);
        const coordsEl = findKmlOne(geom, ".//kml:coordinates");
        if (coordsEl) {
          geom.insertBefore(am, coordsEl);
        } else {
          geom.appendChild(am);
        }
        break;
      }
    }
  }
}

function attachExtendedData(pm: Element, fields: Record<string, string>) {
  const doc = pm.ownerDocument!;
  let ed = findKmlOne(pm, "kml:ExtendedData");
  if (!ed) {
    ed = kmlEl(doc, "ExtendedData");
    pm.appendChild(ed);
  }
  for (const [key, val] of Object.entries(fields)) {
    // remove existing
    for (const d of findKml(ed, `kml:Data[@name='${key}']`)) {
      ed.removeChild(d);
    }
    const d = kmlEl(doc, "Data");
    d.setAttribute("name", key);
    d.appendChild(kmlEl(doc, "value", val));
    ed.appendChild(d);
  }
}

// ── KML element builders ───────────────────────────────────────
function createPointPm(doc: Document, name: string, lon: number, lat: number, altM: number | null, altMode: string): Element {
  const pm = kmlEl(doc, "Placemark");
  pm.appendChild(kmlEl(doc, "name", name));
  const pt = kmlEl(doc, "Point");
  const coords = kmlEl(doc, "coordinates", altM == null ? `${lon.toFixed(8)},${lat.toFixed(8)}` : `${lon.toFixed(8)},${lat.toFixed(8)},${altM.toFixed(3)}`);
  pt.appendChild(kmlEl(doc, "altitudeMode", altMode));
  pt.appendChild(coords);
  pm.appendChild(pt);
  return pm;
}

function createLinestringPm(doc: Document, name: string, coordsLlh: Coord3[], altMode = "absolute", tessellate = 1, extrude = 0): Element {
  const pm = kmlEl(doc, "Placemark");
  pm.appendChild(kmlEl(doc, "name", name));
  const ls = kmlEl(doc, "LineString");
  ls.appendChild(kmlEl(doc, "tessellate", String(tessellate)));
  ls.appendChild(kmlEl(doc, "extrude", String(extrude)));
  ls.appendChild(kmlEl(doc, "altitudeMode", altMode));
  ls.appendChild(kmlEl(doc, "coordinates", formatCoords(coordsLlh)));
  pm.appendChild(ls);
  return pm;
}

function createPolygonPm(doc: Document, name: string, outerLlh: Coord3[], holesLlh?: Coord3[][], altMode = "absolute"): Element {
  const pm = kmlEl(doc, "Placemark");
  pm.appendChild(kmlEl(doc, "name", name));
  const poly = kmlEl(doc, "Polygon");
  poly.appendChild(kmlEl(doc, "extrude", "1"));
  poly.appendChild(kmlEl(doc, "altitudeMode", altMode));

  const outer = kmlEl(doc, "outerBoundaryIs");
  const lr = kmlEl(doc, "LinearRing");
  lr.appendChild(kmlEl(doc, "coordinates", formatCoords(outerLlh)));
  outer.appendChild(lr);
  poly.appendChild(outer);

  if (holesLlh) {
    for (const hole of holesLlh) {
      const ib = kmlEl(doc, "innerBoundaryIs");
      const lrh = kmlEl(doc, "LinearRing");
      lrh.appendChild(kmlEl(doc, "coordinates", formatCoords(hole)));
      ib.appendChild(lrh);
      poly.appendChild(ib);
    }
  }
  pm.appendChild(poly);
  return pm;
}

// ── Survey area clamping ───────────────────────────────────────
function clampSurveyArea(placemark: Element) {
  for (const tag of ["Point", "LineString", "LinearRing", "Polygon"]) {
    for (const ge of findKml(placemark, `.//kml:${tag}`)) {
      for (const coordsEl of findKml(ge, ".//kml:coordinates")) {
        const coords = parseCoords(coordsEl.textContent || "");
        coordsEl.textContent = coords.map(([lon, lat]) => `${lon.toFixed(8)},${lat.toFixed(8)},0.000`).join(" ");
      }
      setAltitudeMode(ge, "absolute");
    }
  }
}

// ── Inject altitudes into coordinate text ──────────────────────
function injectAltitudes(
  text: string,
  fetchElev: (lon: number, lat: number) => number,
  offsetM: number,
  datumOffsetM: number,
  mode: string
): string {
  const coords = parseCoords(text);
  if (!coords.length) return text;
  if (mode === "clampToGround") {
    return coords.map(([lon, lat]) => `${lon.toFixed(8)},${lat.toFixed(8)},0.000`).join(" ");
  }
  const out: Coord3[] = [];
  for (const [lon, lat] of coords) {
    const e = fetchElev(lon, lat);
    out.push([lon, lat, e + datumOffsetM + offsetM]);
  }
  return formatCoords(out);
}

// ── Nearest depth lookup ───────────────────────────────────────
type DepthRecord = { lon: number; lat: number; base: string; minM: number; maxM: number; comm: string };

function dist2(a: [number, number], b: [number, number]) {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function ringToMinMaxLines(
  surfaceLlh: Coord3[],
  nearestDepths: (lon: number, lat: number) => [string, number, number, string] | null
): { minLlh: Coord3[]; maxLlh: Coord3[]; mnAny: number; mxAny: number } {
  const minLlh: Coord3[] = [];
  const maxLlh: Coord3[] = [];
  let mnAny = 0, mxAny = 0;
  for (const [lon, lat, E] of surfaceLlh) {
    const nd = nearestDepths(lon, lat);
    const [mnM, mxM] = nd ? [nd[1], nd[2]] : [0, 0];
    minLlh.push([lon, lat, E - Math.abs(mnM)]);
    maxLlh.push([lon, lat, E - Math.abs(mxM)]);
    mnAny = Math.abs(mnM);
    mxAny = Math.abs(mxM);
  }
  return { minLlh, maxLlh, mnAny, mxAny };
}

// ── Core process_kml ───────────────────────────────────────────
export async function processKml(
  kmlBytes: Buffer,
  opts: ConvertOptions,
  onProgress?: (msg: string) => void
): Promise<Buffer> {
  const { mode, offsetM, datumOffsetM, useDepthFromNames, generateVolumePolygons } = opts;
  const demCache = new Map<string, number>();

  const parser = new DOMParser();
  const doc = parser.parseFromString(kmlBytes.toString("utf-8"), "text/xml");

  // Purge NetworkLinks
  for (const nl of findKml(doc, "//kml:NetworkLink")) {
    nl.parentNode?.removeChild(nl);
  }

  const placemarks = findKml(doc, "//kml:Placemark");
  const trackNodes = findKml(doc, "//gx:Track");

  const needPoints: [number, number][] = [];
  const basePoints: Map<string, DepthRecord[]> = new Map();
  const toInsert: { parent: Element; idx: number; el: Element }[] = [];
  const toRemove: Element[] = [];

  function collectCoords(text: string) {
    for (const [lon, lat] of parseCoords(text)) {
      needPoints.push([lon, lat]);
    }
  }

  // ── FIRST PASS: collect DEM points ─────────────────────────
  onProgress?.("Pass 1: scanning geometry for DEM points...");
  for (const placemark of placemarks) {
    const pmName = getTextContent(placemark, "name");

    // depth anchors (Points)
    if (useDepthFromNames) {
      const pointCoords = findKml(placemark, ".//kml:Point/kml:coordinates");
      if (pointCoords.length) {
        const rng = extractDepthRange(pmName);
        if (rng) {
          const coords = parseCoords(pointCoords[0].textContent || "");
          if (coords.length) {
            const [lon, lat] = coords[0];
            needPoints.push([lon, lat]);
            const mobj = RANGE_RE.exec(pmName);
            const base = mobj ? cleanBase(pmName.slice(0, mobj.index)) : cleanBase(pmName);
            const [mnM, mxM] = rng;
            const comm = whichCommodity(pmName) || "";
            if (!basePoints.has(base)) basePoints.set(base, []);
            basePoints.get(base)!.push({ lon, lat, base, minM: mnM, maxM: mxM, comm });
          }
        }
      }
    }

    // DEM for all geoms
    const coordNodes = findKml(placemark, ".//kml:Point/kml:coordinates | .//kml:LineString/kml:coordinates | .//kml:LinearRing/kml:coordinates");
    for (const node of coordNodes) {
      collectCoords(node.textContent || "");
    }
  }

  // ── DEM fetch (dedup) ──────────────────────────────────────
  if (needPoints.length) {
    const uniq: [number, number][] = [];
    const seen = new Set<string>();
    for (const [lon, lat] of needPoints) {
      const k = keyRound(lon, lat);
      if (!seen.has(k)) { seen.add(k); uniq.push([lon, lat]); }
    }
    onProgress?.(`Fetching DEM for ${uniq.length} unique points...`);
    await sampleElevations(uniq, demCache, onProgress);
  }

  function fetchElev(lon: number, lat: number): number {
    const k = keyRound(lon, lat);
    const v = demCache.get(k);
    if (v !== undefined) return v;
    // fallback — shouldn't normally happen since we pre-fetched
    return 0;
  }

  // Build nearest-depth lookup
  const flatBp: DepthRecord[] = [];
  for (const [, lst] of basePoints) flatBp.push(...lst);

  function nearestDepths(lon: number, lat: number): [string, number, number, string] | null {
    if (!flatBp.length) return null;
    let best: DepthRecord | null = null;
    let bestD = 1e99;
    for (const rec of flatBp) {
      const d = dist2([lon, lat], [rec.lon, rec.lat]);
      if (d < bestD) { bestD = d; best = rec; }
    }
    return best ? [best.base, best.minM, best.maxM, best.comm] : null;
  }

  // ── SECOND PASS: inject altitudes ──────────────────────────
  onProgress?.("Pass 2: injecting altitudes...");
  for (const placemark of placemarks) {
    const pmName = getTextContent(placemark, "name");

    // Survey Area → absolute Z=0
    if (isSurveyArea(pmName)) {
      clampSurveyArea(placemark);
      continue;
    }

    // Disable extrusion
    for (const tag of ["LineString", "Polygon"]) {
      for (const geom of findKml(placemark, `.//kml:${tag}`)) {
        let extr = findKmlOne(geom, "kml:extrude");
        if (!extr) { extr = kmlEl(doc, "extrude", "0"); geom.appendChild(extr); }
        else extr.textContent = "0";

        if (tag === "LineString" && mode === "clampToGround") {
          let tess = findKmlOne(geom, "kml:tessellate");
          if (!tess) { tess = kmlEl(doc, "tessellate", "1"); geom.appendChild(tess); }
          else tess.textContent = "1";
        }
      }
    }

    // Inject altitudes into all coords
    const coordNodes = findKml(placemark, ".//kml:Point/kml:coordinates | .//kml:LineString/kml:coordinates | .//kml:LinearRing/kml:coordinates");
    for (const node of coordNodes) {
      const geom = node.parentNode as Element;
      const parentGeom = geom?.parentNode as Element;
      node.textContent = injectAltitudes(node.textContent || "", fetchElev, offsetM, datumOffsetM, mode);
      setAltitudeMode(parentGeom || geom, mode);
    }

    // Generate 3D structures from depth-encoded points
    if (useDepthFromNames && findKmlOne(placemark, ".//kml:Point")) {
      const rng = extractDepthRange(pmName);
      if (rng) {
        const ptCoords = findKmlOne(placemark, ".//kml:Point//kml:coordinates");
        const coords = parseCoords(ptCoords?.textContent || "");
        if (coords.length) {
          const [lon, lat] = coords[0];
          const [minM, maxM] = rng;
          const e = fetchElev(lon, lat);
          const E = e + datumOffsetM + offsetM;
          const zSurface = E;
          const zMin = E - Math.abs(minM);
          const zMax = E - Math.abs(maxM);

          const [nmSurface, nmMin, nmMax] = derivePrettyNames(pmName);
          const comm = whichCommodity(pmName);

          const folder = kmlEl(doc, "Folder");
          folder.appendChild(kmlEl(doc, "name", `${pmName} – 3D Depths`));

          const pmSurface = createPointPm(doc, nmSurface, lon, lat, zSurface, "absolute");
          const pmMin = createPointPm(doc, nmMin, lon, lat, zMin, "absolute");
          const pmMax = createPointPm(doc, nmMax, lon, lat, zMax, "absolute");

          const fields = {
            source: comm || "",
            surfaceZ_m: zSurface.toFixed(3),
            minZ_m: zMin.toFixed(3),
            maxZ_m: zMax.toFixed(3),
            minDepth_m: Math.abs(minM).toFixed(3),
            maxDepth_m: Math.abs(maxM).toFixed(3),
          };
          for (const p of [pmSurface, pmMin, pmMax]) attachExtendedData(p, fields);

          folder.appendChild(pmSurface);
          folder.appendChild(pmMin);
          folder.appendChild(pmMax);

          const parent = placemark.parentNode as Element;
          const siblings = Array.from(parent.childNodes);
          const idx = siblings.indexOf(placemark);
          toRemove.push(placemark);
          toInsert.push({ parent, idx, el: folder });
        }
      }
    }
  }

  // ── gx:Track altitude injection ────────────────────────────
  for (const tr of trackNodes) {
    const gxCoords = findKml(tr, ".//gx:coord");
    for (const gx of gxCoords) {
      const raw = (gx.textContent || "").trim();
      if (!raw) continue;
      const parts = raw.split(/\s+/);
      if (parts.length >= 2) {
        const lon = parseFloat(parts[0]);
        const lat = parseFloat(parts[1]);
        const h = mode === "clampToGround" ? 0 : fetchElev(lon, lat) + datumOffsetM + offsetM;
        gx.textContent = `${lon.toFixed(8)} ${lat.toFixed(8)} ${h.toFixed(3)}`;
      }
    }
    for (const old of findKml(tr, ".//gx:altitudeMode")) {
      old.parentNode?.removeChild(old);
    }
    const newMode = mode === "clampToGround" ? "absolute" : (mode === "absolute" ? "absolute" : "relativeToGround");
    tr.appendChild(gxEl(doc, "altitudeMode", newMode));
  }

  // ── THIRD PASS: min/max lines and polygons ─────────────────
  onProgress?.("Pass 3: generating depth structures...");
  const pass3Placemarks = findKml(doc, "//kml:Placemark");
  for (const placemark of pass3Placemarks) {
    const pmName = getTextContent(placemark, "name");
    if (isSurveyArea(pmName)) continue;

    const hasPoly = !!findKmlOne(placemark, ".//kml:Polygon");
    const hasLine = !!findKmlOne(placemark, ".//kml:LineString");
    if (!hasPoly && !hasLine) continue;

    let outerCoordsLlh: Coord[] = [];
    const holesLlh: Coord3[][] = [];

    if (hasPoly) {
      const outerEl = findKmlOne(placemark, ".//kml:Polygon//kml:outerBoundaryIs//kml:coordinates");
      if (!outerEl?.textContent?.trim()) continue;
      outerCoordsLlh = parseCoords(outerEl.textContent);
      for (const inner of findKml(placemark, ".//kml:Polygon//kml:innerBoundaryIs")) {
        const ic = findKmlOne(inner, ".//kml:coordinates");
        if (ic?.textContent?.trim()) {
          holesLlh.push(
            parseCoords(ic.textContent).map(([lon, lat, alt]) => [lon, lat, alt ?? (outerCoordsLlh[0]?.[2] ?? 0)] as Coord3)
          );
        }
      }
    } else if (hasLine) {
      const coordsEl = findKmlOne(placemark, ".//kml:LineString//kml:coordinates");
      if (!coordsEl?.textContent?.trim()) continue;
      outerCoordsLlh = parseCoords(coordsEl.textContent);
    }

    if (!outerCoordsLlh.length) continue;

    const surfaceLlh: Coord3[] = outerCoordsLlh.map(([lon, lat, alt]) => [lon, lat, alt ?? 0] as Coord3);
    const [lon0, lat0] = outerCoordsLlh[0];
    const nd = nearestDepths(lon0, lat0);
    const commFinal = whichCommodity(pmName) || (nd ? nd[3] : "") || "";

    const parent = placemark.parentNode as Element;
    const siblings = Array.from(parent.childNodes);
    const idx = siblings.indexOf(placemark);

    // LINESTRING: min/max depth lines
    if (hasLine) {
      const { minLlh, maxLlh, mnAny, mxAny } = ringToMinMaxLines(surfaceLlh, nearestDepths);
      const baseN = cleanBase(pmName);
      const pmMin = createLinestringPm(doc, `${baseN} min depth line`, minLlh);
      const pmMax = createLinestringPm(doc, `${baseN} max depth line`, maxLlh);
      const meta = { source: commFinal, minDepth_m: mnAny.toFixed(3), maxDepth_m: mxAny.toFixed(3) };
      attachExtendedData(pmMin, meta);
      attachExtendedData(pmMax, meta);
      toInsert.push({ parent, idx: idx + 1, el: pmMin });
      toInsert.push({ parent, idx: idx + 2, el: pmMax });
      continue;
    }

    // POLYGON (deposit): min/max lines only
    if (hasPoly && (isDeposit(pmName) || shouldSkipVolume(pmName))) {
      const { minLlh, maxLlh, mnAny, mxAny } = ringToMinMaxLines(surfaceLlh, nearestDepths);
      const baseN = cleanBase(pmName);
      const pmMin = createLinestringPm(doc, `${baseN} min depth line`, minLlh);
      const pmMax = createLinestringPm(doc, `${baseN} max depth line`, maxLlh);
      const meta = { source: commFinal, minDepth_m: mnAny.toFixed(3), maxDepth_m: mxAny.toFixed(3) };
      attachExtendedData(pmMin, meta);
      attachExtendedData(pmMax, meta);
      toInsert.push({ parent, idx: idx + 1, el: pmMin });
      toInsert.push({ parent, idx: idx + 2, el: pmMax });
      continue;
    }

    // POLYGON (non-deposit): optional min/max depth polygons
    if (hasPoly) {
      if (!generateVolumePolygons) continue;
      const { minLlh, maxLlh, mnAny, mxAny } = ringToMinMaxLines(surfaceLlh, nearestDepths);
      const baseN = cleanBase(pmName);
      const zMin = minLlh[0]?.[2] ?? 0;
      const zMax = maxLlh[0]?.[2] ?? 0;

      const pmMinPoly = createPolygonPm(doc, `${baseN} min depth polygon`, minLlh, holesLlh);
      const pmMaxPoly = createPolygonPm(doc, `${baseN} max depth polygon`, maxLlh, holesLlh);
      const meta = {
        source: commFinal,
        minZ_m: zMin.toFixed(3),
        maxZ_m: zMax.toFixed(3),
        minDepth_m: mnAny.toFixed(3),
        maxDepth_m: mxAny.toFixed(3),
      };
      attachExtendedData(pmMinPoly, meta);
      attachExtendedData(pmMaxPoly, meta);
      toInsert.push({ parent, idx: idx + 1, el: pmMinPoly });
      toInsert.push({ parent, idx: idx + 2, el: pmMaxPoly });
    }
  }

  // ── Apply queued edits ─────────────────────────────────────
  for (const pm of toRemove) {
    pm.parentNode?.removeChild(pm);
  }
  toInsert.sort((a, b) => b.idx - a.idx);
  for (const { parent, idx, el } of toInsert) {
    const children = Array.from(parent.childNodes);
    if (idx < children.length) {
      parent.insertBefore(el, children[idx]);
    } else {
      parent.appendChild(el);
    }
  }

  onProgress?.("Serializing KML...");
  const serializer = new XMLSerializer();
  let xmlStr = serializer.serializeToString(doc);
  // Strip any XML declaration produced by the serializer to avoid duplicates
  xmlStr = xmlStr.replace(/^<\?xml[^?]*\?>\s*/i, "");
  xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + xmlStr;
  return Buffer.from(xmlStr, "utf-8");
}

// ── Main entry point ───────────────────────────────────────────
export async function convertKmz(
  inputBuf: Buffer,
  fileName: string,
  opts: ConvertOptions,
  onProgress?: (msg: string) => void
): Promise<{ data: Buffer; outName: string }> {
  const isKmz = fileName.toLowerCase().endsWith(".kmz");
  let kmlBytes: Buffer;
  let originalKmz: Buffer | undefined;

  if (isKmz) {
    onProgress?.("Extracting KML from KMZ...");
    kmlBytes = await unzipKmzToKml(inputBuf);
    originalKmz = inputBuf;
  } else {
    kmlBytes = inputBuf;
  }

  const outKml = await processKml(kmlBytes, opts, onProgress);

  onProgress?.("Re-packing as KMZ...");
  const outKmz = await rezipKmlToKmz(outKml, originalKmz);

  const base = fileName.replace(/\.(kmz|kml)$/i, "");
  return { data: outKmz, outName: `${base}_processed_3d.kmz` };
}
