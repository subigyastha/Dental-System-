import { NextResponse } from "next/server";

export async function PATCH() {
  return NextResponse.json(
    {
      error:
        "This Next.js operational route is disabled. Send follow-up commands to the Nest API.",
    },
    { status: 410 },
  );
}
