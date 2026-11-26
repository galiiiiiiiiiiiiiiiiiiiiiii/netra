import { NextResponse } from "next/server";
import { isRequestAuthorized, unauthorizedResponse } from "@/lib/auth";
import { getPPPActive } from "@/lib/mikrotik/client";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const active = await getPPPActive();

    return NextResponse.json({
      success: true,
      count: active.length,
      active,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
