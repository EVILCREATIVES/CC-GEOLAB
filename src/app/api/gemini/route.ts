import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_API_KEY in environment." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      messages?: ChatMessage[];
      fileContext?: string | null;
    };

    const messages = body.messages ?? [];
    const fileContext = typeof body.fileContext === "string" ? body.fileContext.slice(0, 8000) : null;
    const sanitized = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .slice(-12);

    if (!sanitized.length) {
      return NextResponse.json({ error: "No messages provided." }, { status: 400 });
    }

    const systemPrompt = fileContext
      ? `You are a senior geological data analyst for CC Explorations (ccexplorations.com), specializing in AMRT (Airborne Magnetic Radiometric Technology) resource analysis. You provide highly accurate, detailed, and professional-grade geological interpretations.

Your expertise includes:
- AMRT survey data interpretation: magnetic anomaly analysis, radiometric signatures, spectral decomposition
- Mineral resource classification (Cu, Au, Oil, H2O, Gas, Void) based on geophysical signatures
- Depth modeling: min/max depth correlation, subsurface structure interpretation, vein thickness analysis
- Exploration target prioritization: anomaly ranking, confidence assessment, follow-up recommendations
- Industry-standard reporting: JORC/NI 43-101 compliant language, resource estimation terminology
- Geological hazard identification and risk assessment

When analyzing loaded data:
- Reference specific entity names, folder structures, coordinates, and depth values from the data
- Provide quantitative analysis where possible (depth ranges, spatial extents, anomaly magnitudes)
- Distinguish between high-confidence and speculative interpretations
- Recommend specific follow-up actions (ground-truthing, infill sampling, geochemical assays)
- Use proper geological and geophysical terminology
- Flag any data quality concerns (gaps, inconsistencies, insufficient coverage)

Always complete your full reasoning. Never stop mid-sentence or mid-thought.

--- LOADED FILE DATA ---
${fileContext}
--- END FILE DATA ---`
      : "You are a senior geological data analyst for CC Explorations (ccexplorations.com), specializing in AMRT (Airborne Magnetic Radiometric Technology) resource analysis. You provide highly accurate, detailed, and professional-grade geological interpretations. Your expertise spans magnetic anomaly analysis, radiometric signatures, mineral resource classification (Cu, Au, Oil, H2O, Gas, Void), depth modeling, vein structure interpretation, exploration target prioritization, and industry-standard reporting (JORC/NI 43-101 terminology). No file is currently loaded. You can answer general questions about AMRT technology, geological interpretation methods, exploration best practices, and resource analysis. Always complete your full reasoning. Never stop mid-sentence or mid-thought.";

    const contents = [
      {
        role: "user",
        parts: [{ text: systemPrompt }],
      },
      ...sanitized.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.text }],
      })),
    ];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents,
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
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
      error?: { message?: string };
    };

    if (!resp.ok) {
      return NextResponse.json(
        { error: json.error?.message ?? "Gemini request failed." },
        { status: resp.status },
      );
    }

    const text =
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("\n")
        .trim() ?? "";

    return NextResponse.json({ text: text || "No response generated." });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
