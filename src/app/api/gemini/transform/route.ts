import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Missing GOOGLE_API_KEY in environment." },
        { status: 500 },
      );
    }

    const body = (await request.json()) as { kmlText?: string };
    const kmlText = body.kmlText;

    if (!kmlText || typeof kmlText !== "string") {
      return NextResponse.json(
        { error: "No kmlText provided." },
        { status: 400 },
      );
    }

    const systemPrompt = `You are a KML file transformer for CC Explorations' AMRT (Atomic Mineral Resonance Tomography) system. Your task is to rewrite a KML file to convert 2D surface placemarks that contain depth-range data into 3D underground entities for subsurface visualization in Cesium.

IDENTIFICATION:
- Find all <Placemark> elements whose <name> contains a depth range pattern
- Depth ranges look like: "339-456'" or "100-200m" or "50.5-150 ft" or "V1a/ 339-456'"
- The pattern is: optional prefix text, then two numbers separated by a dash (- or –), optionally followed by a unit (', ft, feet, foot, m, meter, meters)
- Only transform placemarks that have <Point> geometry with <coordinates>

TRANSFORMATION — for each matching placemark, REPLACE it with THREE new placemarks:

1. TOP POINT:
<Placemark>
  <name>{BaseName}/ Top {minDepth}{unit}</name>
  <styleUrl>{original styleUrl if any}</styleUrl>
  <ExtendedData><Data name="_3dDepth"><value>true</value></Data></ExtendedData>
  <Point>
    <altitudeMode>relativeToGround</altitudeMode>
    <coordinates>{lon},{lat},{-topMeters}</coordinates>
  </Point>
</Placemark>

2. BOTTOM POINT:
<Placemark>
  <name>{BaseName}/ Bottom {maxDepth}{unit}</name>
  <styleUrl>{original styleUrl if any}</styleUrl>
  <ExtendedData><Data name="_3dDepth"><value>true</value></Data></ExtendedData>
  <Point>
    <altitudeMode>relativeToGround</altitudeMode>
    <coordinates>{lon},{lat},{-bottomMeters}</coordinates>
  </Point>
</Placemark>

3. DEPOSIT BOX — a MultiGeometry with 6 polygon faces forming a rectangular box:
<Placemark>
  <name>{BaseName}/ {minDepth}-{maxDepth}{unit}</name>
  <ExtendedData><Data name="_3dDepth"><value>true</value></Data></ExtendedData>
  <MultiGeometry>
    <!-- Top face -->
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c0lon,c0lat,-topM c1lon,c1lat,-topM c2lon,c2lat,-topM c3lon,c3lat,-topM c0lon,c0lat,-topM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <!-- Bottom face -->
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c0lon,c0lat,-botM c1lon,c1lat,-botM c2lon,c2lat,-botM c3lon,c3lat,-botM c0lon,c0lat,-botM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <!-- 4 side faces connecting top and bottom at each edge -->
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c0lon,c0lat,-topM c1lon,c1lat,-topM c1lon,c1lat,-botM c0lon,c0lat,-botM c0lon,c0lat,-topM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c1lon,c1lat,-topM c2lon,c2lat,-topM c2lon,c2lat,-botM c1lon,c1lat,-botM c1lon,c1lat,-topM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c2lon,c2lat,-topM c3lon,c3lat,-topM c3lon,c3lat,-botM c2lon,c2lat,-botM c2lon,c2lat,-topM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
    <Polygon><altitudeMode>relativeToGround</altitudeMode><outerBoundaryIs><LinearRing><coordinates>
      c3lon,c3lat,-topM c0lon,c0lat,-topM c0lon,c0lat,-botM c3lon,c3lat,-botM c3lon,c3lat,-topM
    </coordinates></LinearRing></outerBoundaryIs></Polygon>
  </MultiGeometry>
</Placemark>

DEPTH CONVERSION:
- If unit is ', ft, feet, or foot: multiply by 0.3048 to get meters
- If unit is m, meter, or meters: use as-is
- If no unit specified, assume feet (')
- topMeters = min(depth1, depth2) converted to meters
- bottomMeters = max(depth1, depth2) converted to meters

BOX CORNER OFFSETS from the point coordinates:
  c0 = (lon - 0.0001, lat - 0.000075)
  c1 = (lon + 0.0001, lat - 0.000075)
  c2 = (lon + 0.0001, lat + 0.000075)
  c3 = (lon - 0.0001, lat + 0.000075)

Use 10 decimal places for lon/lat and 4 for altitude values.

BaseName = the text before the depth range in the original name, with trailing slashes, backslashes, and spaces trimmed. If empty, use "Deposit".

CRITICAL RULES:
- Preserve ALL existing content that is NOT a depth-range placemark: styles, folders, other placemarks, etc.
- Preserve the XML declaration and all namespace declarations exactly
- Output ONLY the raw XML of the complete rewritten KML document
- Do NOT wrap the output in markdown code fences or add ANY explanation
- Maintain proper XML structure`;

    const contents = [
      {
        role: "user",
        parts: [
          {
            text:
              systemPrompt +
              "\n\nHere is the KML file to transform:\n\n" +
              kmlText,
          },
        ],
      },
    ];

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: 0.1,
            topP: 0.9,
            maxOutputTokens: 65536,
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
      return NextResponse.json(
        { error: json.error?.message ?? "Gemini transform request failed." },
        { status: resp.status },
      );
    }

    let text =
      json.candidates?.[0]?.content?.parts
        ?.map((p) => p.text ?? "")
        .join("")
        .trim() ?? "";

    // Strip markdown code fences if Gemini added them
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:xml|kml)?\n?/, "").replace(/\n?```$/, "");
    }

    if (!text || !text.includes("<kml")) {
      return NextResponse.json(
        { error: "Gemini did not return valid KML." },
        { status: 500 },
      );
    }

    return NextResponse.json({ kml: text });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected server error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
