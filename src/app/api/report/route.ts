import { NextResponse } from "next/server";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} from "docx";
import PDFDocument from "pdfkit";
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
      return NextResponse.json({ reportText });
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
interface ReportBlock {
  type: "h1" | "h2" | "h3" | "paragraph" | "bullet";
  text: string;
  bold?: boolean;
}

function parseMarkdown(text: string): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).replace(/\*\*/g, "") });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "h2", text: line.slice(3).replace(/\*\*/g, "") });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "h1", text: line.slice(2).replace(/\*\*/g, "") });
    } else if (/^[-*]\s/.test(line)) {
      blocks.push({ type: "bullet", text: line.slice(2).replace(/\*\*/g, "") });
    } else {
      // Detect bold lines like **something**
      const isBold = /^\*\*.*\*\*$/.test(line.trim());
      blocks.push({
        type: "paragraph",
        text: line.replace(/\*\*/g, ""),
        bold: isBold,
      });
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
            text: block.text,
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 400, after: 200 },
          }),
        );
        break;
      case "h2":
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 300, after: 150 },
          }),
        );
        break;
      case "h3":
        children.push(
          new Paragraph({
            text: block.text,
            heading: HeadingLevel.HEADING_3,
            spacing: { before: 200, after: 100 },
          }),
        );
        break;
      case "bullet":
        children.push(
          new Paragraph({
            children: [new TextRun({ text: block.text, size: 22 })],
            bullet: { level: 0 },
            spacing: { after: 60 },
          }),
        );
        break;
      default:
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.text,
                size: 22,
                bold: block.bold,
              }),
            ],
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
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 60, size: "A4" });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Title page header
    doc
      .fontSize(22)
      .fillColor("#2EA8FF")
      .text("CC EXPLORATIONS", { align: "center" });
    doc.moveDown(0.3);
    doc
      .fontSize(16)
      .fillColor("#000000")
      .text(`AMRT Survey Report — ${fileName}`, { align: "center" });
    doc.moveDown(0.2);
    doc
      .fontSize(10)
      .fillColor("#888888")
      .text(
        `Generated: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
        { align: "center" },
      );
    doc.moveDown(1.5);

    // Content
    const blocks = parseMarkdown(reportText);
    for (const block of blocks) {
      switch (block.type) {
        case "h1":
          doc.moveDown(0.8);
          doc.fontSize(18).fillColor("#1a3a5c").text(block.text);
          doc.moveDown(0.3);
          break;
        case "h2":
          doc.moveDown(0.6);
          doc.fontSize(14).fillColor("#2a4a6c").text(block.text);
          doc.moveDown(0.2);
          break;
        case "h3":
          doc.moveDown(0.4);
          doc.fontSize(12).fillColor("#3a5a7c").text(block.text, { bold: true } as PDFKit.Mixins.TextOptions);
          doc.moveDown(0.15);
          break;
        case "bullet":
          doc
            .fontSize(10)
            .fillColor("#000000")
            .text(`  •  ${block.text}`, { indent: 20 });
          doc.moveDown(0.1);
          break;
        default:
          doc
            .fontSize(10)
            .fillColor("#000000")
            .text(block.text, { lineGap: 2 });
          doc.moveDown(0.15);
          break;
      }
    }

    doc.end();
  });
}
