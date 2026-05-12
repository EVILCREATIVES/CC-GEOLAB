import { NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { prisma } from "@/lib/prisma";

const REPORT_PASSWORD = "ccadmin2026";

// ── Deterministic facts extraction ──────────────────────────
// The only way to guarantee that regenerating the report doesn't change
// the *data* (locations, depths, target counts, ranking) is to compute
// those facts ourselves in code and inject them as an authoritative
// block. Temperature/seed on Gemini reduce drift but don't eliminate it.

type ApiEntity = {
  name?: string;
  folder?: string;
  type?: string;
  properties?: Record<string, string | number>;
};

type Target = {
  id: string;
  folder: string;
  confidence: number | null; // 0..100, null if unknown
  depthTop: number | null;   // metres, null if unknown
  depthBottom: number | null;
  resource: string | null;
  lat: number | null;
  lon: number | null;
};

const NUM_RE = /-?\d+(?:\.\d+)?/;

function pickProp(
  props: Record<string, string | number> | undefined,
  matchers: RegExp[],
): string | number | null {
  if (!props) return null;
  for (const m of matchers) {
    for (const [k, v] of Object.entries(props)) {
      if (m.test(k)) return v;
    }
  }
  return null;
}

function toNumber(v: string | number | null): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const m = String(v).match(NUM_RE);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function buildTarget(e: ApiEntity): Target {
  const p = e.properties ?? {};
  const confRaw = pickProp(p, [/confidence/i, /probability/i, /score/i, /%/]);
  const conf = toNumber(confRaw);
  const confidence =
    conf == null ? null : conf <= 1 ? Math.round(conf * 1000) / 10 : Math.round(conf * 10) / 10;

  const depthMin = toNumber(pickProp(p, [/depth.*(min|top|from|start)/i, /^min.*depth/i, /^top/i]));
  const depthMax = toNumber(pickProp(p, [/depth.*(max|bottom|to|end)/i, /^max.*depth/i, /^bottom/i]));
  const depthSingle = toNumber(pickProp(p, [/^depth$/i, /^z$/i, /elevation/i]));

  const lat = toNumber(pickProp(p, [/^lat/i, /latitude/i]));
  const lon = toNumber(pickProp(p, [/^lon/i, /^lng/i, /longitude/i]));
  const resourceRaw = pickProp(p, [/resource/i, /commodity/i, /mineral/i, /element/i, /type$/i]);

  return {
    id: (e.name ?? "(unnamed)").trim(),
    folder: (e.folder ?? "(root)").trim(),
    confidence,
    depthTop: depthMin ?? depthSingle,
    depthBottom: depthMax ?? depthSingle,
    resource: resourceRaw == null ? null : String(resourceRaw),
    lat,
    lon,
  };
}

// Deterministic ranking: confidence desc, then shallower top depth,
// then target ID ascending. Unknowns sort last within each tier.
function rankTargets(ts: Target[]): Target[] {
  return [...ts].sort((a, b) => {
    const ac = a.confidence ?? -1;
    const bc = b.confidence ?? -1;
    if (ac !== bc) return bc - ac;
    const ad = a.depthTop ?? Number.POSITIVE_INFINITY;
    const bd = b.depthTop ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    return a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" });
  });
}

function inferLocation(entities: ApiEntity[], targets: Target[], fileName: string): string {
  // 1. Look for an explicit location-like property on any entity.
  for (const e of entities) {
    const v = pickProp(e.properties, [/^location$/i, /^site$/i, /^region$/i, /^country$/i, /^area$/i, /^prospect$/i]);
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // 2. Use the first non-root folder name (often the survey site).
  const folder = entities.map((e) => e.folder).find((f) => f && f !== "(root)");
  if (folder) return folder;
  // 3. Fall back to centroid coordinates if we have any.
  const coords = targets.filter((t) => t.lat != null && t.lon != null);
  if (coords.length > 0) {
    const lat = coords.reduce((s, t) => s + (t.lat as number), 0) / coords.length;
    const lon = coords.reduce((s, t) => s + (t.lon as number), 0) / coords.length;
    return `${lat.toFixed(4)}\u00B0, ${lon.toFixed(4)}\u00B0`;
  }
  // 4. Last resort: the filename, but flagged so the model knows it's weak.
  return fileName ? `Survey Site (${fileName})` : "Survey Site";
}

function buildFactsBlock(entities: ApiEntity[] | null, fileName: string): {
  facts: string;
  location: string;
} {
  if (!entities || entities.length === 0) {
    return { facts: "", location: "Survey Site" };
  }

  const targets = entities
    .filter((e) => (e.type ?? "") !== "label")
    .map(buildTarget);
  const ranked = rankTargets(targets);
  const location = inferLocation(entities, targets, fileName);

  const depthValues = targets.flatMap((t) => [t.depthTop, t.depthBottom]).filter((v): v is number => v != null);
  const depthMin = depthValues.length ? Math.min(...depthValues) : null;
  const depthMax = depthValues.length ? Math.max(...depthValues) : null;

  const folderCounts = new Map<string, number>();
  for (const e of entities) folderCounts.set(e.folder ?? "(root)", (folderCounts.get(e.folder ?? "(root)") ?? 0) + 1);

  const lines: string[] = [];
  lines.push(`LOCATION: ${location}`);
  lines.push(`TOTAL_TARGETS: ${targets.length}`);
  if (depthMin != null && depthMax != null) {
    lines.push(`DEPTH_PENETRATION_M: ${depthMin} to ${depthMax}`);
  } else {
    lines.push(`DEPTH_PENETRATION_M: not specified in source data`);
  }
  lines.push(`FOLDERS: ${[...folderCounts.entries()].map(([f, c]) => `${f} (${c})`).join("; ")}`);
  lines.push("");
  lines.push("RANKED_TARGETS (rank | id | resource | depth_top_m | depth_bottom_m | confidence_pct):");
  for (let i = 0; i < ranked.length; i++) {
    const t = ranked[i];
    lines.push(
      `${i + 1} | ${t.id} | ${t.resource ?? "n/a"} | ${t.depthTop ?? "n/a"} | ${t.depthBottom ?? "n/a"} | ${t.confidence ?? "n/a"}`,
    );
  }
  // Hard cap to keep prompt size sane on very large surveys.
  const facts = lines.join("\n").slice(0, 12000);
  return { facts, location };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      format?: "docx" | "pdf" | "google-doc";
      fileContext?: string | null;
      entities?: ApiEntity[] | null;
      chatHistory?: Array<{ role: string; text: string }>;
      fileName?: string;
    };

    if (body.password !== REPORT_PASSWORD) {
      return NextResponse.json({ error: "Invalid password." }, { status: 401 });
    }

    const fileContext =
      typeof body.fileContext === "string"
        ? body.fileContext.slice(0, 8000)
        : null;
    const fileName = body.fileName || "AMRT Survey";
    const { facts, location } = buildFactsBlock(body.entities ?? null, fileName);

    const format =
      body.format === "pdf"
        ? "pdf"
        : body.format === "google-doc"
        ? "google-doc"
        : "docx";
    // Generate report text via Gemini. The deterministic FACTS block we
    // computed above is the authoritative source of truth; the model is
    // only allowed to wordsmith around it.
    const reportText = await generateReport(fileContext, body.chatHistory ?? [], fileName, facts, location);

    if (format === "google-doc") {
      // Return DOCX bytes; the client uploads them to the user's own
      // Google Drive (per-user OAuth) and converts to a Google Doc.
      const buffer = await buildDocx(reportText, fileName);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(fileName)}_Report.docx"`,
          "X-Report-Filename": sanitizeFilename(fileName),
        },
      });
    }

    if (format === "docx") {
      const buffer = await buildDocx(reportText, fileName);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(fileName)}_Report.docx"`,
        },
      });
    } else {
      const buffer = await buildPdf(reportText, fileName);
      return new NextResponse(new Uint8Array(buffer), {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${sanitizeFilename(fileName)}_Report.pdf"`,
        },
      });
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    console.error("[report]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9 _\-().]/g, "").trim() || "Report";
}

async function generateReport(
  fileContext: string | null,
  chatHistory: Array<{ role: string; text: string }>,
  fileName: string,
  facts: string,
  location: string,
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("Missing GOOGLE_API_KEY");

  const chatSummary =
    chatHistory.length > 0
      ? `\n\n--- PREVIOUS ANALYSIS CHAT ---\n${chatHistory
          .slice(-10)
          .map((m) => `${m.role.toUpperCase()}: ${m.text}`)
          .join("\n\n")}\n--- END CHAT ---`
      : "";

  let templateExamples = "";
  try {
    const rule = await prisma.aiRule.findUnique({ where: { key: "gemini_report_examples" } });
    if (rule?.value?.trim()) {
      templateExamples = rule.value.trim().slice(0, 24000);
    }
  } catch {
    // If DB lookup fails, proceed without template examples.
  }

  const prompt = `You are a senior exploration geologist and report writer for CC Explorations (ccexplorations.com). You are writing a full, narrative, client-facing AMRT Survey Report — not a data dump. The reader is an investor or project manager who needs prose, interpretation, and context, with the numbers woven in where relevant.

## ABSOLUTE NAMING RULES (NON-NEGOTIABLE):
- AMRT always expands to exactly "Atomic Mineral Resonance Tomography". Never "Atomic Minerals", "Resonance Topography", "Active Mineral...", or any other variant. The first mention must be "AMRT (Atomic Mineral Resonance Tomography)"; subsequent mentions use "AMRT".
- The survey is named by **Location**, not by filename. Use the location supplied below verbatim. Title MUST be exactly: "# AMRT Survey Report — ${location}". Do not use the source filename anywhere.

## DATA RULES (the FACTS block is the single source of truth for NUMBERS):
The block below was extracted from the survey data by the server. When you cite a depth, confidence, target ID, target count, or rank order, it MUST match this block exactly. Do not round, rescale, reorder, or invent numbers. If a value is "n/a", write "not specified in the survey data" (do not guess).

You are NOT required — and should NOT — paste the raw FACTS block as-is into the report. Instead, **interpret** it: explain what the data means, why a target ranks where it does, what the depth distribution implies, what the confidence values suggest about reliability, and so on. The data must appear; the data must not be the entire report.

--- BEGIN FACTS ---
${facts || "(no structured entities supplied; describe report as a template only and state that no survey data was provided)"}
--- END FACTS ---

## GEOLOGY TONE RULES:
- AMRT is an **initial remote-sensing exploration tool**, not a proven assay. Use hedged language: "interpreted as", "consistent with", "may indicate", "suggests", "potential", "anomaly". Avoid "proven", "confirmed", "definitely", "is a deposit of", "guaranteed".
- Always state that ground-truthing (drilling, geochemistry, geophysics) is required before any resource or reserve claim.
- Do not claim JORC / NI 43-101 compliance for the AMRT data itself; only mention these codes for the follow-up work that would be needed to reach compliance.

## REPORT STRUCTURE — write each section as flowing prose paragraphs (not just bullet lists):
1. **EXECUTIVE SUMMARY** — 2–4 paragraphs. What was surveyed, where (${location}), what was found at a high level, what the recommended next steps are. Mention overall depth penetration and total target count in narrative form.
2. **SURVEY METHODOLOGY** — 2–3 paragraphs explaining AMRT technology in accessible terms: satellite-based remote-sensing, atomic resonance signatures, how depth is inferred, what "confidence" means, and the technology's known limitations.
3. **SITE DESCRIPTION** — 1–2 paragraphs on geographic location and geological setting. If coordinates are present, mention them in prose (e.g. "centred near 35.28°N, 128.47°E"). If no regional geology is in the source data, say "Regional geological context was not supplied with the survey input and should be added during the desktop study phase." Do NOT invent regional geology.
4. **RESULTS & FINDINGS** — Several paragraphs of analysis, NOT a table dump. Group targets by resource type or by depth horizon, describe spatial clustering, note the highest-confidence anomalies and the deepest ones, and discuss what the depth penetration (DEPTH_PENETRATION_M) tells us about the survey's reach. Cite specific targets by ID with their depth and confidence inline (e.g. "Target R1c, interpreted at 420–680 m with 92% AMRT confidence, …"). Aim for 4–8 paragraphs.
5. **TARGET PRIORITIZATION** — Open with 1–2 paragraphs explaining the ranking criteria in plain English (confidence first, then shallower top depth, then ID for tie-breaks) and why that order makes operational sense. Then render the ranked target table as a markdown table with columns "Rank | Target ID | Resource | Depth Top (m) | Depth Bottom (m) | AMRT Confidence (%)" using rows in the order given by RANKED_TARGETS. After the table, add 1–2 paragraphs of commentary highlighting the top 3 priorities and any noteworthy patterns (e.g. clustering, depth trends).
6. **RECOMMENDATIONS** — Several paragraphs proposing specific follow-up work: which top-ranked targets to drill first, where to run ground geophysics, whether soil geochemistry is warranted, and what budget tier each phase implies. Tie recommendations to specific target IDs from the ranked list.
7. **CONCLUSION** — 1–2 paragraphs summarising what was found, the indicative (not proven) commercial potential, and the ground-truthing required before any resource estimate.

## STYLE REQUIREMENTS:
- Write in flowing professional prose. Bullet lists are allowed only inside Recommendations and inside the prioritization table; everything else must be paragraphs.
- Cite numbers inline within sentences, not as standalone lines.
- Hedge all geological claims as described above.
- Aim for a substantive report — roughly 1,200–2,000 words of prose plus the one ranked table.

${templateExamples ? `## REPORT TEMPLATE EXAMPLES (style/structure/voice only)
Match the **narrative depth and tone** of these approved examples. Do NOT copy their locations, target IDs, depths, or numbers — those belong to other surveys. Use them as a guide for how much prose to write per section.
--- BEGIN EXAMPLES ---
${templateExamples}
--- END EXAMPLES ---` : ""}

${fileContext ? `## RAW SOURCE EXTRACT (additional context — FACTS block takes precedence on any number conflict)\n${fileContext}` : ""}
${chatSummary}

Generate the full narrative report now using markdown headings (# ## ###). The first line MUST be: # AMRT Survey Report — ${location}. Do not use code fences. Do not paste the raw FACTS block into the output.`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          // Slightly warmer for richer narrative prose. The numbers stay
          // stable because the FACTS block, not the temperature, is what
          // pins the data.
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: 16384,
        },
      }),
    },
  );

  const json = (await resp.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
    error?: { message?: string };
  };

  if (!resp.ok) {
    throw new Error(json.error?.message ?? "Gemini request failed.");
  }

  return (
    json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("\n")
      .trim() ?? "Report generation failed."
  );
}

// ── Parse markdown text into structured paragraphs ──────────
interface InlineRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

interface ReportBlock {
  type: "h1" | "h2" | "h3" | "paragraph" | "bullet";
  runs: InlineRun[];
  // Convenience flag — true when the entire line is wrapped in **...**.
  bold?: boolean;
}

// Parse inline markdown emphasis: **bold**, __bold__, *italic*, _italic_.
// Treats single-asterisk segments as italic, double as bold. Handles
// nesting like ***word*** by combining bold+italic.
function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  let i = 0;
  let buf = "";
  let bold = false;
  let italic = false;
  const flush = () => {
    if (buf) {
      runs.push({ text: buf, bold: bold || undefined, italic: italic || undefined });
      buf = "";
    }
  };
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if ((ch === "*" || ch === "_") && next === ch) {
      flush();
      bold = !bold;
      i += 2;
      continue;
    }
    if (ch === "*" || ch === "_") {
      flush();
      italic = !italic;
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();
  // If parsing ended with an unclosed marker, any leftover state is
  // already baked into the runs we emitted; nothing more to do.
  return runs.length > 0 ? runs : [{ text }];
}

// Strip emphasis markers entirely (used for headings, where styling is
// handled by the heading level itself).
function stripInline(text: string): string {
  return text.replace(/\*\*/g, "").replace(/__/g, "").replace(/(^|[^*])\*(?!\*)/g, "$1").replace(/(^|[^_])_(?!_)/g, "$1");
}

function parseMarkdown(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", runs: [{ text: stripInline(line.slice(4)) }] });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "h2", runs: [{ text: stripInline(line.slice(3)) }] });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "h1", runs: [{ text: stripInline(line.slice(2)) }] });
    } else {
      const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
      if (bulletMatch) {
        blocks.push({ type: "bullet", runs: parseInline(bulletMatch[1]) });
      } else {
        const trimmed = line.trim();
        const isWholeBold = /^\*\*[\s\S]+\*\*$/.test(trimmed) || /^__[\s\S]+__$/.test(trimmed);
        blocks.push({
          type: "paragraph",
          runs: parseInline(line),
          bold: isWholeBold || undefined,
        });
      }
    }
  }
  return blocks;
}

// ── Build DOCX ──────────────────────────────────────────────
async function buildDocx(
  reportText: string,
  fileName: string,
): Promise<Buffer> {
  const blocks = parseMarkdown(reportText);
  const children: Paragraph[] = [];

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "CC EXPLORATIONS",
          bold: true,
          size: 36,
          color: "2EA8FF",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }),
  );
  // Note: the survey-specific title ("AMRT Survey Report — <Location>")
  // is emitted by the model as the first H1 in the markdown body, so we
  // intentionally keep this header generic to avoid duplicating /
  // contradicting the location-based name with the source filename.
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: "AMRT Survey Report",
          bold: true,
          size: 28,
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
  );
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
          size: 20,
          color: "888888",
        }),
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    }),
  );

  for (const block of blocks) {
    switch (block.type) {
      case "h1":
        children.push(
          new Paragraph({
            text: block.runs.map((r) => r.text).join(""),
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        );
        break;
      case "h2":
        children.push(
          new Paragraph({
            text: block.runs.map((r) => r.text).join(""),
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          }),
        );
        break;
      case "h3":
        children.push(
          new Paragraph({
            text: block.runs.map((r) => r.text).join(""),
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          }),
        );
        break;
      case "bullet":
        children.push(
          new Paragraph({
            children: block.runs.map(
              (r) =>
                new TextRun({
                  text: r.text,
                  size: 22,
                  bold: r.bold,
                  italics: r.italic,
                }),
            ),
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
        break;
      default:
        children.push(
          new Paragraph({
            children: block.runs.map(
              (r) =>
                new TextRun({
                  text: r.text,
                  size: 22,
                  bold: r.bold || block.bold,
                  italics: r.italic,
                }),
            ),
            spacing: { after: 120 },
          }),
        );
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── Build PDF ───────────────────────────────────────────────
async function buildPdf(
  reportText: string,
  fileName: string,
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageW = 595.28; // A4
  const pageH = 841.89;
  const margin = 60;
  const contentW = pageW - margin * 2;

  let page = pdfDoc.addPage([pageW, pageH]);
  let y = pageH - margin;

  function ensureSpace(needed: number) {
    if (y - needed < margin) {
      page = pdfDoc.addPage([pageW, pageH]);
      y = pageH - margin;
    }
  }

  function drawText(
    text: string,
    opts: { size: number; font: typeof helvetica; color?: readonly [number, number, number]; indent?: number; lineGap?: number },
  ) {
    const { size, font, color = [0, 0, 0] as [number, number, number], indent = 0, lineGap = 2 } = opts;
    const maxWidth = contentW - indent;
    // Word-wrap manually
    const words = text.split(" ");
    let line = "";
    const lines: string[] = [];
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    const lineH = size + lineGap;
    ensureSpace(lines.length * lineH + 4);
    for (const l of lines) {
      page.drawText(l, {
        x: margin + indent,
        y,
        size,
        font,
        color: rgb(color[0], color[1], color[2]),
      });
      y -= lineH;
    }
  }

  // Title — keep generic; the location-based subtitle comes from the
  // model's first H1 (see prompt rules in generateReport).
  drawText("CC EXPLORATIONS", { size: 22, font: helveticaBold, color: [0.18, 0.659, 1.0] });
  y -= 6;
  drawText("AMRT Survey Report", { size: 14, font: helveticaBold, color: [0, 0, 0] });
  y -= 4;
  drawText(
    `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    { size: 9, font: helvetica, color: [0.53, 0.53, 0.53] },
  );
  y -= 20;

  const blocks = parseMarkdown(reportText);
  for (const block of blocks) {
    const flatText = block.runs.map((r) => r.text).join("");
    const anyBold = block.runs.some((r) => r.bold) || block.bold;
    switch (block.type) {
      case "h1":
        y -= 14;
        drawText(flatText, { size: 16, font: helveticaBold, color: [0.1, 0.23, 0.36] });
        y -= 4;
        break;
      case "h2":
        y -= 10;
        drawText(flatText, { size: 13, font: helveticaBold, color: [0.17, 0.29, 0.42] });
        y -= 2;
        break;
      case "h3":
        y -= 6;
        drawText(flatText, { size: 11, font: helveticaBold, color: [0.23, 0.36, 0.49] });
        y -= 2;
        break;
      case "bullet":
        drawText(`• ${flatText}`, { size: 10, font: anyBold ? helveticaBold : helvetica, indent: 16 });
        y -= 2;
        break;
      default:
        drawText(flatText, { size: 10, font: anyBold ? helveticaBold : helvetica });
        y -= 2;
        break;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
