import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdmin, unauthorized } from "@/lib/auth";

/** POST — admin login (just validates the password, returns ok) */
export async function POST(request: Request) {
  try {
    const { password } = (await request.json()) as { password?: string };
    if (password !== "ccadmin2026") {
      return NextResponse.json({ error: "Wrong password" }, { status: 401 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}

/** GET — verify admin session (pass password as Bearer token) */
export async function GET(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  // Return basic stats
  const [users, uploads, logs] = await Promise.all([
    prisma.user.count(),
    prisma.upload.count(),
    prisma.accessLog.count(),
  ]);
  return NextResponse.json({ ok: true, stats: { users, uploads, logs } });
}
