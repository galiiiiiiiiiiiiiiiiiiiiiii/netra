import { NextResponse } from "next/server";
import { isRequestAuthorized, unauthorizedResponse } from "@/lib/auth";
import { getInterfaces } from "@/lib/mikrotik/client";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const interfaces = await getInterfaces();

    return NextResponse.json({
      success: true,
      interfaces,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}