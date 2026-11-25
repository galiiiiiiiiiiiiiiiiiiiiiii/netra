import { NextResponse } from "next/server";
import { getPPPActive } from "@/lib/mikrotik/client";

export async function GET() {
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
