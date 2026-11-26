import { NextResponse } from "next/server";
import { isRequestAuthorized, unauthorizedResponse } from "@/lib/auth";
import { getRouterStatus } from "@/lib/mikrotik/client";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const data = await getRouterStatus();

    const resource = data.resources;

    return NextResponse.json({
      success: true,
      connected: true,
      router: {
        identity: data.identity,
        version: resource?.version,
        uptime: resource?.uptime,
        cpuLoad: resource?.["cpu-load"],
        freeMemory: resource?.["free-memory"],
        totalMemory: resource?.["total-memory"],
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
