import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      error:
        "This Next.js operational status route is disabled. Use the Nest health endpoints for service status.",
    },
    { status: 410 },
  );
}
