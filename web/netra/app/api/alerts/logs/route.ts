import { NextResponse } from "next/server";
import { isRequestAuthorized, unauthorizedResponse } from "@/lib/auth";
import { getRouterLogs } from "@/lib/mikrotik/client";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return unauthorizedResponse();
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
