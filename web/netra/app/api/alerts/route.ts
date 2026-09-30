import { NextResponse } from "next/server";
import { collectAlertEvents } from "@/lib/alerts/collector";

export async function GET() {
  try {
    const result = await collectAlertEvents();
    return NextResponse.json({ success: true, ...result });
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
