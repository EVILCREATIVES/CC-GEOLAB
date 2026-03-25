import { NextResponse } from "next/server";
import { processKml, unzipKmzToKml, type ConvertOptions } from "@/lib/kmz-converter";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getClientInfo } from "@/lib/auth";

export const maxDuration = 120; // allow long DEM fetches
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userId = (formData.get("userId") as string) || null;

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

    // Extract KML from KMZ if needed
    const isKmz = fileName.toLowerCase().endsWith(".kmz");
    const kmlBytes = isKmz ? await unzipKmzToKml(inputBuf) : inputBuf;

    // Process KML (DEM elevations, 3D depth structures)
    const outKml = await processKml(kmlBytes, opts, onProgress);

    // Store in Vercel Blob + DB (non-blocking, don't fail the response)
    const { ip, region } = getClientInfo(request);
    put(`uploads/${Date.now()}_${fileName}`, file, { access: "public", addRandomSuffix: true })
      .then((blob) =>
        prisma.upload.create({
          data: { fileName, blobUrl: blob.url, blobSize: file.size, ip, region, userId },
        })
      )
      .catch((err) => console.error("[convert3d] blob/db store error:", err));

    // Log access
    prisma.accessLog
      .create({
        data: { ip, region, userAgent: request.headers.get("user-agent") || "", path: "/api/convert3d", fileName, userId },
      })
      .catch(() => {});

    // Return processed KML text directly
    return new NextResponse(outKml.toString("utf-8"), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.google-earth.kml+xml",
        "X-Convert-Logs": JSON.stringify(logs),
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[convert3d] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
