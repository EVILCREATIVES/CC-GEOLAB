import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { validateAdmin } from "@/lib/auth";

// GET: returns global joystick preset
// POST: admin only, updates global preset
export async function GET() {
  const preset = await prisma.aiRule.findUnique({ where: { key: "joystick_preset" } });
  if (preset) {
    try {
      return NextResponse.json({ settings: JSON.parse(preset.value) });
    } catch {}
  }
  return NextResponse.json({ settings: null });
}

export async function POST(req: NextRequest) {
  if (!validateAdmin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  await prisma.aiRule.upsert({
    where: { key: "joystick_preset" },
    update: { value: JSON.stringify(body) },
    create: { key: "joystick_preset", value: JSON.stringify(body) },
  });
  return NextResponse.json({ ok: true });
}
