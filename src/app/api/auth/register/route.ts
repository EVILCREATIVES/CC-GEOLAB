import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

/** POST — register a new advanced user */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      email?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      password?: string;
    };

    const { email, firstName, lastName, company, password } = body;

    if (!email || !firstName || !lastName || !password) {
      return NextResponse.json(
        { error: "email, firstName, lastName and password are required." },
        { status: 400 }
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Invalid email format." }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return NextResponse.json({ error: "Email already registered." }, { status: 409 });
    }

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, firstName, lastName, company: company || "", password: hash },
      select: { id: true, email: true, firstName: true, lastName: true, company: true, createdAt: true },
    });

    return NextResponse.json({ user }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
