import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdmin, unauthorized } from "@/lib/auth";

/** GET — admin: list access logs (newest first) */
export async function GET(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  const { searchParams } = new URL(request.url);
  const take = Math.min(parseInt(searchParams.get("limit") || "200"), 1000);
  const logs = await prisma.accessLog.findMany({
    orderBy: { createdAt: "desc" },
    take,
  });
  return NextResponse.json({ logs });
}
