import { NextRequest, NextResponse } from "next/server";
import { getRouterLogs } from "@/lib/mikrotik/client";

export async function GET(request: NextRequest) {
  if (
    !process.env.NETRA_INTERNAL_SECRET ||
    request.headers.get("x-netra-internal-secret") !==
      process.env.NETRA_INTERNAL_SECRET
  ) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const logs = await getRouterLogs();
    return NextResponse.json({
      success: true,
      logs: (logs as any[]).slice(-20).reverse(),
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
