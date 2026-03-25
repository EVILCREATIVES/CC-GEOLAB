import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdmin, unauthorized } from "@/lib/auth";

/** GET — list all AI rules */
export async function GET(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  const rules = await prisma.aiRule.findMany({ orderBy: { key: "asc" } });
  return NextResponse.json({ rules });
}

/** PUT — update an AI rule by key */
export async function PUT(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  try {
    const { key, value, label } = (await request.json()) as {
      key: string;
      value: string;
      label?: string;
    };
    if (!key || typeof value !== "string") {
      return NextResponse.json({ error: "key and value required" }, { status: 400 });
    }
    const rule = await prisma.aiRule.upsert({
      where: { key },
      update: { value, ...(label ? { label } : {}) },
      create: { key, value, label: label || key },
    });
    return NextResponse.json({ rule });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** DELETE — remove an AI rule by key */
export async function DELETE(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  const { key } = (await request.json()) as { key?: string };
  if (!key) return NextResponse.json({ error: "key required" }, { status: 400 });
  await prisma.aiRule.delete({ where: { key } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
