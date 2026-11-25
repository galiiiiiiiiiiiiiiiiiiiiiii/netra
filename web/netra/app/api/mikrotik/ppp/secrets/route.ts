import { NextResponse } from "next/server";
import { getPPPSecrets } from "@/lib/mikrotik/client";

export async function GET() {
  try {
    const secrets = await getPPPSecrets();

    return NextResponse.json({
      success: true,
      count: secrets.length,
      secrets,
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
