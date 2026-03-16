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
    };

    const messages = body.messages ?? [];
    const sanitized = messages
      .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.text === "string")
      .slice(-12);

    if (!sanitized.length) {
      return NextResponse.json({ error: "No messages provided." }, { status: 400 });
    }

    const systemPrompt =
      "You are a geological data consultation assistant for a Cesium KMZ/KML viewer. Be concise, practical, and safety-aware. If uncertain, say what additional data is needed.";

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
            maxOutputTokens: 1024,
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
