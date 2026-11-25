import { NextRequest, NextResponse } from "next/server";
import { getInterfaces } from "@/lib/mikrotik/client";

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
    const interfaces = await getInterfaces();
    return NextResponse.json({
      success: true,
      interfaces: (interfaces as any[]).map((item) => ({
        id: item[".id"],
        name: item.name,
        type: item.type,
        running: item.running,
        disabled: item.disabled,
        status:
          item.disabled === "true"
            ? "disabled"
            : item.running === "true"
              ? "running"
              : "down",
        "mac-address": item["mac-address"],
        mtu: item.mtu,
        comment: item.comment,
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
