import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateAdmin, unauthorized } from "@/lib/auth";

/** GET — admin: list all registered users */
export async function GET(request: Request) {
  if (!validateAdmin(request)) return unauthorized();
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      company: true,
      createdAt: true,
      _count: { select: { uploads: true } },
    },
  });
  return NextResponse.json({ users });
}
