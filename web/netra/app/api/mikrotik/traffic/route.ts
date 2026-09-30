import { NextResponse } from "next/server";
import { withMikrotikClient } from "@/lib/mikrotik/client";

export async function GET() {
  return withMikrotikClient(async (api) => {
    try {
      const interfaces = await api.write("/interface/print");

      const trafficInterfaces = await Promise.all(
        interfaces.map(async (item: any) => {
          let monitor: any = {};

          try {
            const stats = await api.write("/interface/monitor-traffic", [
              `=interface=${item.name}`,
              "=once=yes",
            ]);

            monitor = stats?.[0] || {};
          } catch (monitorError) {
            console.warn(
              `MONITOR TRAFFIC FAILED: ${item.name || item[".id"]}`,
              monitorError,
            );
          }

          const rxBitsPerSecond = Number(monitor["rx-bits-per-second"] || 0);
          const txBitsPerSecond = Number(monitor["tx-bits-per-second"] || 0);
          const hasMonitorRate =
            "rx-bits-per-second" in monitor ||
            "tx-bits-per-second" in monitor ||
            "fp-rx-bits-per-second" in monitor ||
            "fp-tx-bits-per-second" in monitor;

          return {
            ...item,
            ...(hasMonitorRate
              ? {
                  "rx-bits-per-second": rxBitsPerSecond,
                  "tx-bits-per-second": txBitsPerSecond,
                }
              : {}),
          };
        }),
      );

      return NextResponse.json({
        success: true,
        interfaces: trafficInterfaces,
      });
    } catch (error) {
      console.error("TRAFFIC API ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  });
}
