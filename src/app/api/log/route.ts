import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClientInfo } from "@/lib/auth";

/** POST — log a page visit or file upload event */
export async function POST(request: Request) {
  try {
    const { ip, region } = getClientInfo(request);
    const body = (await request.json()) as {
      path?: string;
      fileName?: string;
      userId?: string;
    };

    await prisma.accessLog.create({
      data: {
        ip,
        region,
        userAgent: request.headers.get("user-agent") || "",
        path: body.path || "/",
        fileName: body.fileName || null,
        userId: body.userId || null,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Don't fail the user experience over logging
    console.error("[accesslog]", err);
    return NextResponse.json({ ok: false });
  }
}
