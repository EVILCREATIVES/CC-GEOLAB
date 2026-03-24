import { NextResponse } from "next/server";
import { convertKmz, type ConvertOptions } from "@/lib/kmz-converter";

export const maxDuration = 120; // allow long DEM fetches
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const fileName = file.name || "upload.kmz";
    const arrayBuffer = await file.arrayBuffer();
    const inputBuf = Buffer.from(arrayBuffer);

    const opts: ConvertOptions = {
      mode: "absolute",
      offsetM: 0,
      datumOffsetM: 0,
      useDepthFromNames: true,
      generateVolumePolygons: false,
    };

    const logs: string[] = [];
    const onProgress = (msg: string) => {
      console.log("[convert3d]", msg);
      logs.push(msg);
    };

    const { data, outName } = await convertKmz(inputBuf, fileName, opts, onProgress);

    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.google-earth.kmz",
        "Content-Disposition": `attachment; filename="${outName}"`,
        "X-Convert-Logs": JSON.stringify(logs),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[convert3d] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
