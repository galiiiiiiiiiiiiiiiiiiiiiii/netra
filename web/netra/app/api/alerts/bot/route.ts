import { NextRequest, NextResponse } from "next/server";
import { collectAlertEvents } from "@/lib/alerts/collector";

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.NETRA_INTERNAL_SECRET;
  const receivedSecret = request.headers.get("x-netra-internal-secret");

  if (!expectedSecret || receivedSecret !== expectedSecret) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await collectAlertEvents();
    return NextResponse.json({
      success: true,
      events: result.events,
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
