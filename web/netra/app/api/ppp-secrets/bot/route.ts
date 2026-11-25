import { NextRequest, NextResponse } from "next/server";
import { getPPPStatus } from "@/lib/mikrotik/client";

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
    const users = await getPPPStatus();
    return NextResponse.json({
      success: true,
      users: users.map((user) => ({
        name: user.name,
        status: user.status,
        profile: user.profile,
        ip: user.ip,
        uptime: user.uptime,
        callerId: user.callerId,
        lastDisconnectReason: user.lastDisconnectReason,
        comment: user.comment,
      })),
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
