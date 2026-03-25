import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { getClientInfo } from "@/lib/auth";

export const maxDuration = 120;
export const dynamic = "force-dynamic";

/** POST — store uploaded KMZ/KML in Vercel Blob and record in DB */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userId = (formData.get("userId") as string) || null;

    if (!file) {
      return NextResponse.json({ error: "No file provided." }, { status: 400 });
    }

    const { ip, region } = getClientInfo(request);

    // Upload to Vercel Blob
    const blob = await put(`uploads/${Date.now()}_${file.name}`, file, {
      access: "public", // needed for Cesium to load; prefix is unique enough
      addRandomSuffix: true,
    });

    // Record in DB
    const upload = await prisma.upload.create({
      data: {
        fileName: file.name,
        blobUrl: blob.url,
        blobSize: file.size,
        ip,
        region,
        userId,
      },
    });

    // Also log as access event
    await prisma.accessLog.create({
      data: {
        ip,
        region,
        userAgent: request.headers.get("user-agent") || "",
        path: "/api/uploads",
        fileName: file.name,
        userId,
      },
    }).catch(() => {}); // non-critical

    return NextResponse.json({
      id: upload.id,
      fileName: upload.fileName,
      blobUrl: upload.blobUrl,
      createdAt: upload.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[uploads]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** GET — list uploads. Registered users see their own history; admin sees all */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const uploads = await prisma.upload.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      fileName: true,
      blobUrl: true,
      blobSize: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ uploads });
}
