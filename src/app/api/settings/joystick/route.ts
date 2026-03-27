import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdmin } from "@/lib/auth";

// GET: returns user joystick settings (if logged in), else preset
// POST: saves user joystick settings (if logged in)
export async function GET(req: NextRequest) {
  const userId = req.headers.get("x-user-id") || null;
  if (userId) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (user?.joystickSettings) {
      return NextResponse.json({ settings: user.joystickSettings, source: "user" });
    }
  }
  // fallback to preset
  const preset = await prisma.aiRule.findUnique({ where: { key: "joystick_preset" } });
  if (preset) {
    try {
      return NextResponse.json({ settings: JSON.parse(preset.value), source: "preset" });
    } catch {}
  }
  // fallback to hardcoded defaults
  return NextResponse.json({ settings: null, source: "default" });
}

export async function POST(req: NextRequest) {
  const userId = req.headers.get("x-user-id") || null;
  if (!userId) return NextResponse.json({ error: "Not logged in" }, { status: 401 });
  const body = await req.json();
  await prisma.user.update({ where: { id: userId }, data: { joystickSettings: body } });
  return NextResponse.json({ ok: true });
}
