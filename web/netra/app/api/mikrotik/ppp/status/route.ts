import { NextResponse } from "next/server";
import { getPPPIPPool, getPPPStatus } from "@/lib/mikrotik/client";

export async function GET() {
  try {
    const [users, poolIps] = await Promise.all([
      getPPPStatus(),
      getPPPIPPool(),
    ]);

    const online = users.filter((user) => user.status === "online").length;

    const offline = users.filter((user) => user.status === "offline").length;

    const disabled = users.filter((user) => user.status === "disabled").length;

    return NextResponse.json({
      success: true,
      summary: {
        total: users.length,
        online,
        offline,
        disabled,
      },
      users,
      poolIps,
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
