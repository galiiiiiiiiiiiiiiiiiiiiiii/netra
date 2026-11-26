import { NextResponse } from "next/server";
import { isRequestAuthorized, unauthorizedResponse } from "@/lib/auth";
import { getPPPSecrets } from "@/lib/mikrotik/client";

export async function GET(request: Request) {
  if (!isRequestAuthorized(request)) {
    return unauthorizedResponse();
  }

  try {
    const rawSecrets = (await getPPPSecrets()) as Array<Record<string, unknown>>;
    const secrets = rawSecrets.map(({ password: _password, ...rest }) => rest);

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
