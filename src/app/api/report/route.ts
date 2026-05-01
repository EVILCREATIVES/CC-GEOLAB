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
import { google } from "googleapis";
import { Readable } from "stream";
import { prisma } from "@/lib/prisma";

const REPORT_PASSWORD = "ccadmin2026";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      password?: string;
      format?: "docx" | "pdf" | "google-doc";
      fileContext?: string | null;
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

    const format =
      body.format === "pdf"
        ? "pdf"
        : body.format === "google-doc"
        ? "google-doc"
        : "docx";
    // Generate report text via Gemini
    const reportText = await generateReport(fileContext, body.chatHistory ?? [], fileName);

    if (format === "google-doc") {
      const buffer = await buildDocx(reportText, fileName);
      const url = await createGoogleDoc(buffer, fileName);
      return NextResponse.json({ url });
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

  const prompt = `You are a senior report writer for CC Explorations (ccexplorations.com), creating a professional AMRT Survey Report.

Generate a complete, professional report for the survey "${fileName}" using the data and analysis below. Follow CC Explorations' standard reporting format:

## REPORT STRUCTURE:
1. **EXECUTIVE SUMMARY** — Brief overview of survey objectives, location, and key findings
2. **SURVEY METHODOLOGY** — AMRT technology description, satellite sensors used, data acquisition parameters
3. **SITE DESCRIPTION** — Geographic location, geological setting, known mineralization history
4. **RESULTS & FINDINGS** — Detailed analysis of detected anomalies, resource classifications, depth ranges, confidence levels
5. **TARGET PRIORITIZATION** — Ranked list of exploration targets with justification
6. **RECOMMENDATIONS** — Specific follow-up actions (ground-truthing, drilling, further surveys)
7. **CONCLUSION** — Summary of findings and commercial potential

## STYLE REQUIREMENTS:
- Use professional geological terminology (JORC/NI 43-101 compliant)
- Include specific depth values, coordinates, and measurements from the data
- Distinguish high-confidence vs speculative interpretations
- Reference AMRT as CC Explorations' proprietary satellite-based technology
- Be thorough and detailed — this is a client-facing deliverable

${templateExamples ? `## REPORT TEMPLATE EXAMPLES (HIGH PRIORITY)
Match structure, tone, and section ordering from these approved examples whenever the input context supports it.
--- BEGIN EXAMPLES ---
${templateExamples}
--- END EXAMPLES ---` : ""}

${fileContext ? `--- LOADED FILE DATA ---\n${fileContext}\n--- END FILE DATA ---` : "No file data loaded. Generate a template report structure."}
${chatSummary}

Generate the full report now. Use markdown headings (# ## ###) for structure. Do not use code fences.`;

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.3,
          topP: 0.9,
          maxOutputTokens: 8192,
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
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `AMRT Survey Report — ${fileName}`,
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

  // Title
  drawText("CC EXPLORATIONS", { size: 22, font: helveticaBold, color: [0.18, 0.659, 1.0] });
  y -= 6;
  drawText(`AMRT Survey Report — ${fileName}`, { size: 14, font: helveticaBold, color: [0, 0, 0] });
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

// ── Upload DOCX to Google Drive and convert to Google Doc ───
async function createGoogleDoc(docxBuffer: Buffer, fileName: string): Promise<string> {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error(
      "Google Docs export not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON in the server environment.",
    );
  }

  let creds: { client_email: string; private_key: string };
  try {
    creds = JSON.parse(raw) as { client_email: string; private_key: string };
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON.");
  }
  // Vercel often stores newlines escaped as \n inside the JSON string.
  if (creds.private_key && creds.private_key.includes("\\n")) {
    creds.private_key = creds.private_key.replace(/\\n/g, "\n");
  }

  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });

  const safe = sanitizeFilename(fileName);
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || undefined;

  const created = await drive.files.create({
    requestBody: {
      name: `${safe} — AMRT Report`,
      mimeType: "application/vnd.google-apps.document",
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      body: Readable.from(docxBuffer),
    },
    fields: "id, webViewLink",
    supportsAllDrives: true,
  });

  const fileId = created.data.id;
  if (!fileId) throw new Error("Drive upload returned no file id.");

  // Make it accessible via link so the user can open it without
  // sharing the service account.
  await drive.permissions.create({
    fileId,
    requestBody: { role: "writer", type: "anyone" },
    supportsAllDrives: true,
  });

  return (
    created.data.webViewLink ?? `https://docs.google.com/document/d/${fileId}/edit`
  );
}
