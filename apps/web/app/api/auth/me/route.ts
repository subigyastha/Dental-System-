import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "This Next.js authentication route is disabled. Use the Nest API." },
    { status: 410 },
  );
}
