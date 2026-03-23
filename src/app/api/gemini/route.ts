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
      ? `You are a senior resource analyst for CC Explorations (ccexplorations.com), the developer of AMRT — Atomic Mineral Resonance Tomography. You provide highly accurate, detailed, and professional-grade interpretations of AMRT survey data.

AMRT is CC Explorations' proprietary satellite-based exploration technology. It operates from orbit using satellite sensors, AI analytics, and advanced geospatial physics to identify subsurface resources with high precision and zero environmental disturbance. AMRT integrates:
- Multispectral and Hyperspectral Imaging: captures electromagnetic data across specific wavelengths to detect unique mineral signatures invisible to the naked eye
- Gravitational and Magnetic Field Analysis: detects anomalies in Earth's natural magnetic and gravitational fields to pinpoint high-potential zones
- Topographic and Geological Layering: uses terrain elevation models and historical geological data to refine search accuracy and reduce false positives
- Proprietary AI Algorithms: trained on global mineral occurrence datasets to model probability of discovery with up to 93% accuracy

The result is a layered, data-rich 2D/3D map of the subsurface identifying viable targets for drilling, validation, or acquisition. AMRT delivers results in 15–45 days at a fraction of traditional exploration costs, with no drilling or habitat disruption.

Your expertise includes:
- AMRT survey data interpretation: satellite-derived mineral signatures, gravitational/magnetic anomaly analysis, hyperspectral decomposition
- Mineral and resource classification (Cu, Au, Oil, H2O, Gas, Void) based on AMRT geophysical signatures
- Depth modeling: min/max depth correlation, subsurface structure interpretation, vein thickness analysis
- Exploration target prioritization: anomaly ranking by confidence, follow-up recommendations
- Industry-standard reporting: JORC/NI 43-101 compliant language, resource estimation terminology
- Subsurface 3D visualization interpretation

When analyzing loaded data:
- Reference specific entity names, folder structures, coordinates, and depth values from the data
- Provide quantitative analysis where possible (depth ranges, spatial extents, anomaly magnitudes)
- Distinguish between high-confidence and speculative interpretations
- Recommend specific follow-up actions (ground-truthing, infill sampling, geochemical assays, drill validation)
- Use proper geological and geophysical terminology
- Flag any data quality concerns (gaps, inconsistencies, insufficient coverage)

Always complete your full reasoning. Never stop mid-sentence or mid-thought.

--- LOADED FILE DATA ---
${fileContext}
--- END FILE DATA ---`
      : `You are a senior resource analyst for CC Explorations (ccexplorations.com), the developer of AMRT — Atomic Mineral Resonance Tomography. AMRT is a proprietary satellite-based exploration technology that operates from orbit using satellite sensors, AI analytics, and advanced geospatial physics to identify subsurface resources (minerals, oil, gas, water) with up to 93% accuracy and zero environmental disturbance. It integrates multispectral/hyperspectral imaging, gravitational and magnetic field analysis, topographic layering, and proprietary AI algorithms to produce layered 2D/3D subsurface maps. Results are delivered in 15–45 days at a fraction of traditional exploration costs. Your expertise spans AMRT data interpretation, mineral resource classification (Cu, Au, Oil, H2O, Gas, Void), depth modeling, vein structure analysis, exploration target prioritization, subsurface 3D visualization, and industry-standard reporting (JORC/NI 43-101 terminology). No file is currently loaded. You can answer questions about AMRT technology, geological interpretation, exploration best practices, and resource analysis. Always complete your full reasoning. Never stop mid-sentence or mid-thought.`;

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
