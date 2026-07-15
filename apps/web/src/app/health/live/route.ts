import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json(
    { service: "web", status: "live", timestamp: new Date().toISOString() },
    { headers: { "cache-control": "no-store" } }
  );
}
