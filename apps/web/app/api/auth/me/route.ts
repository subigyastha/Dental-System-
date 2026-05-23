import { NextRequest, NextResponse } from "next/server";

import { sessionFromAuthorization } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const result = await sessionFromAuthorization(
    request.headers.get("authorization"),
  );

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.user);
}
