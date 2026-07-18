import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error:
        "This Next.js operational route is disabled. Send client commands to the Nest API.",
    },
    { status: 410 },
  );
}
