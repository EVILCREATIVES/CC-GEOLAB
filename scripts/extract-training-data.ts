/**
 * Extract training data from .docx reports + .kmz files.
 *
 * Reads all .docx from training-data/reports/ and .kmz from training-data/kmz/,
 * auto-matches them by name, strips embedded images, auto-detects resource types,
 * and stores each report as a separate ReportExample in the DB.
 *
 * Also generates a condensed style guide in AiRule "gemini_report_style_guide".
 *
 * Usage:  npx tsx scripts/extract-training-data.ts
 */

import "dotenv/config";
import fs from "fs";
import path from "path";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as { convertToMarkdown: (opts: { path: string }) => Promise<{ value: string }> };
import AdmZip from "adm-zip";
import { prisma } from "../src/lib/prisma";

const TRAINING_DIR = path.resolve(__dirname, "../training-data");
const REPORTS_DIR = path.join(TRAINING_DIR, "reports");
const KMZ_DIR = path.join(TRAINING_DIR, "kmz");
const OUTPUT_JSON = path.join(TRAINING_DIR, "training-output.json");

/* ── Resource detection ───────────────────────────── */

const RESOURCE_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: "Au", patterns: [/\bAu\b/i, /\bgold\b/i] },
  { tag: "Cu", patterns: [/\bCu\b/i, /\bcopper\b/i] },
  { tag: "Oil", patterns: [/\boil\b/i, /\bpetroleum\b/i, /\bhydrocarbon\b/i] },
  { tag: "H2O", patterns: [/\bH2O\b/i, /\bwater\b/i, /\baquifer\b/i] },
  { tag: "Li", patterns: [/\bLi\b/i, /\blithium\b/i] },
  { tag: "Gas", patterns: [/\bgas\b/i, /\bnatural gas\b/i] },
  { tag: "Void", patterns: [/\bvoid\b/i, /\bcavity\b/i, /\bcave\b/i] },
  { tag: "Ag", patterns: [/\bAg\b/i, /\bsilver\b/i] },
  { tag: "Graphene", patterns: [/\bgraphe?ne\b/i, /\bgraphite\b/i] },
  { tag: "Ru", patterns: [/\bruthenium\b/i, /\bRu\b/] },
];

function detectResources(name: string, text: string): string[] {
  const combined = `${name} ${text}`;
  const found: string[] = [];
  for (const { tag, patterns } of RESOURCE_PATTERNS) {
    if (patterns.some((p) => p.test(combined))) {
      found.push(tag);
    }
  }
  return found.length ? found : ["General"];
}

/* ── Helpers ──────────────────────────────────────── */

/** Strip base64 image embeds from mammoth output */
function stripImages(md: string): string {
  return md.replace(/!\[\]\(data:image\/[^)]+\)/g, "").trim();
}

/** Extract markdown text from a .docx file */
async function extractDocx(filePath: string): Promise<string> {
  const result = await mammoth.convertToMarkdown({ path: filePath });
  return stripImages(result.value);
}

/** Extract placemark names, folders, geometry stats from a KMZ */
function extractKmzSummary(filePath: string): string {
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();

  let kmlContent = "";
  for (const entry of entries) {
    if (entry.entryName.endsWith(".kml")) {
      kmlContent += entry.getData().toString("utf-8");
    }
  }

  if (!kmlContent) return "(No KML content found in KMZ)";

  const docName = kmlContent.match(/<Document>[\s\S]*?<name>(.*?)<\/name>/)?.[1] || "Unknown";
  const folders = [...kmlContent.matchAll(/<Folder>[\s\S]*?<name>(.*?)<\/name>/g)].map((m) => m[1]);
  const placemarks = [...kmlContent.matchAll(/<Placemark>[\s\S]*?<name>(.*?)<\/name>/g)].map((m) =>
    m[1]
      .replace(/&apos;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&"),
  );
  const points = (kmlContent.match(/<Point>/g) || []).length;
  const lines = (kmlContent.match(/<LineString>/g) || []).length;
  const polygons = (kmlContent.match(/<Polygon>/g) || []).length;

  return [
    `KMZ: ${docName}`,
    `Folders: ${folders.join(", ") || "none"}`,
    `Placemarks (${placemarks.length}): ${placemarks.join("; ")}`,
    `Geometry: ${points} points, ${lines} lines, ${polygons} polygons`,
  ].join("\n");
}

/** Match filenames by exact base name */
function baseName(f: string): string {
  return f.replace(/\.(docx?|kmz|kml)$/i, "").trim();
}

/* ── Style guide extraction ───────────────────────── */

function buildStyleGuide(reports: Array<{ name: string; text: string; resources: string[] }>): string {
  // Collect common section headings
  const headingCounts = new Map<string, number>();
  for (const r of reports) {
    const headings = r.text.match(/^__(.+?)__$/gm) || [];
    for (const h of headings) {
      const clean = h.replace(/__/g, "").trim().toLowerCase();
      headingCounts.set(clean, (headingCounts.get(clean) || 0) + 1);
    }
  }

  const commonHeadings = [...headingCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([h, count]) => `- "${h}" (used in ${count}/${reports.length} reports)`);

  const resourceTypes = new Set<string>();
  for (const r of reports) r.resources.forEach((t) => resourceTypes.add(t));

  return `=== CC EXPLORATIONS REPORT STYLE GUIDE ===
(Extracted from ${reports.length} real client reports)

REPORT STRUCTURE:
CC Explorations reports consistently follow this structure:

Common Section Headings (by frequency):
${commonHeadings.join("\n")}

RESOURCE TYPES COVERED: ${[...resourceTypes].sort().join(", ")}

WRITING CONVENTIONS:
- Reports begin with date and "Satellite Assessment Report: [Site Name]"
- Opening paragraph states CC Explorations LLC has completed the survey per the Satellite Service Agreement
- Methodology section explains AMRT technology: atomic frequencies, resonance signatures, quantum spin states, binary code conversion, depth determination
- Survey points describe depth ranges in feet (') or meters (m) with accuracy noted as "within 10%"
- Vein descriptions include width ranges and averages
- Deposit assessments reference specific entity IDs (D1, D2, V1a, V1b, R1a, etc.)
- Recommendations include GPS centering (Trimble), drilling targets, and follow-up exploration
- Depth values reference "top depth" (min) and "bottom depth" (max) of mineral encounter
- Reports note that vein width measurements relate to ore-bearing structure widths
- Professional disclaimer about AMRT being an "initial exploration assessment tool"
- Closing includes company contact: ccexplorations.com

TONE & TERMINOLOGY:
- Professional, data-driven, confident but measured
- Uses "frequency resonances", "atomic levels", "quantum physics", "code stacks"
- References KMZ files and Google Earth for visualization
- Describes deposits as "commercially viable" when appropriate
- Uses industry terms: lode deposits, veining structures, ore bodies, fault lines
- Distinguishes between veins, deposits, and reservoirs
- Includes specific depth-to-depth ranges (e.g., "461-670 feet")
- Width descriptions for veins (e.g., "5-17 feet, with averages of 5-14 feet")
`;
}

/* ── Main ─────────────────────────────────────────── */

async function main() {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error(`❌ No reports/ directory found at ${REPORTS_DIR}`);
    process.exit(1);
  }

  const docxFiles = fs.readdirSync(REPORTS_DIR).filter((f) => /\.docx?$/i.test(f)).sort();
  const kmzFiles = fs.existsSync(KMZ_DIR) ? fs.readdirSync(KMZ_DIR).filter((f) => /\.kmz$/i.test(f)).sort() : [];

  if (!docxFiles.length) {
    console.error("❌ No .docx files found in training-data/reports/");
    process.exit(1);
  }

  console.log(`📄 Found ${docxFiles.length} .docx report(s)`);
  console.log(`🗺️  Found ${kmzFiles.length} .kmz file(s)\n`);

  // Build name→kmz map
  const kmzByBase = new Map<string, string>();
  for (const k of kmzFiles) kmzByBase.set(baseName(k), k);

  // Extract all
  const allReports: Array<{
    name: string;
    docxFile: string;
    kmzFile: string | null;
    text: string;
    kmzSummary: string | null;
    resources: string[];
  }> = [];

  for (let i = 0; i < docxFiles.length; i++) {
    const docx = docxFiles[i];
    const base = baseName(docx);
    const kmz = kmzByBase.get(base) || null;

    console.log(`[${i + 1}/${docxFiles.length}] ${docx}${kmz ? " ↔ " + kmz : " (no KMZ)"}`);

    const text = await extractDocx(path.join(REPORTS_DIR, docx));
    let kmzSummary: string | null = null;

    if (kmz) {
      try {
        kmzSummary = extractKmzSummary(path.join(KMZ_DIR, kmz));
      } catch (e) {
        console.warn(`  ⚠️  Could not parse KMZ: ${e}`);
      }
    }

    const resources = detectResources(base, text);

    allReports.push({ name: base, docxFile: docx, kmzFile: kmz, text, kmzSummary, resources });
  }

  // Save JSON for reference
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(allReports, null, 2), "utf-8");
  console.log(`\n📁 JSON saved → ${OUTPUT_JSON}`);

  // Clear old ReportExample rows and insert fresh
  await prisma.reportExample.deleteMany({});
  console.log("🗑️  Cleared old ReportExample rows");

  let totalChars = 0;
  for (const r of allReports) {
    await prisma.reportExample.create({
      data: {
        name: r.name,
        resources: r.resources,
        reportText: r.text,
        kmzSummary: r.kmzSummary,
        charCount: r.text.length,
      },
    });
    totalChars += r.text.length;
    console.log(`  ✅ ${r.name} [${r.resources.join(",")}] (${(r.text.length / 1024).toFixed(1)} KB)`);
  }

  // Build and save style guide
  const styleGuide = buildStyleGuide(allReports);
  await prisma.aiRule.upsert({
    where: { key: "gemini_report_style_guide" },
    update: { value: styleGuide, label: "Report Style Guide (auto-extracted)" },
    create: { key: "gemini_report_style_guide", label: "Report Style Guide (auto-extracted)", value: styleGuide },
  });
  console.log(`\n📋 Style guide saved to DB (${(styleGuide.length / 1024).toFixed(1)} KB)`);

  console.log(`\n✅ Done! ${allReports.length} reports stored in DB`);
  console.log(`   Total clean text: ${(totalChars / 1024).toFixed(1)} KB`);
  console.log(`   Resource breakdown:`);

  const tagCounts = new Map<string, number>();
  for (const r of allReports) {
    for (const t of r.resources) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  }
  for (const [tag, count] of [...tagCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${tag}: ${count} reports`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
