import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_PASSWORD = "ccadmin2026";

/** Validate admin password from Authorization header (Bearer token) */
export function validateAdmin(request: NextRequest | Request): boolean {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  return token === ADMIN_PASSWORD;
}

/** Return 401 JSON response */
export function unauthorized() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

/** Extract client IP and region from request headers */
export function getClientInfo(request: NextRequest | Request): { ip: string; region: string } {
  const headers = request.headers;
  const ip =
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown";
  const rawRegion =
    headers.get("x-vercel-ip-city") ||
    headers.get("x-vercel-ip-country") ||
    "";
  const region = decodeURIComponent(rawRegion);
  return { ip, region };
}
