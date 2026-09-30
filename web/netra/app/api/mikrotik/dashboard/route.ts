import { NextResponse } from "next/server";
import { withMikrotikClient } from "@/lib/mikrotik/client";

export async function GET() {
  return withMikrotikClient(async (api) => {
    try {
      const [systemResource, interfaces, pppActive, logs] = await Promise.all([
        api.write("/system/resource/print"),
        api.write("/interface/print"),
        api.write("/ppp/active/print"),
        api.write("/log/print"),
      ]);

      const resource = systemResource?.[0] ?? {};

      const totalMemory = Number(resource["total-memory"] ?? 0);
      const freeMemory = Number(resource["free-memory"] ?? 0);
      const usedMemory = totalMemory - freeMemory;

      const activeInterfaces = interfaces.filter(
        (item: any) => item.running === "true" && item.disabled !== "true",
      );

      return NextResponse.json({
        success: true,

        router: {
          identity: resource["board-name"] ?? "-",
          routerOs: resource["version"] ?? "-",
          uptime: resource["uptime"] ?? "-",
          cpuLoad: Number(resource["cpu-load"] ?? 0),
          architecture: resource["architecture-name"] ?? "-",
          buildTime: resource["build-time"] ?? "-",
        },

        memory: {
          total: totalMemory,
          free: freeMemory,
          used: usedMemory,
          usagePercent: totalMemory > 0 ? (usedMemory / totalMemory) * 100 : 0,
        },

        interfaces: {
          total: interfaces.length,
          active: activeInterfaces.length,
          data: interfaces,
        },

        ppp: {
          active: pppActive,
        },

        logs: logs.slice(-10).reverse(),
      });
    } catch (error) {
      console.error("DASHBOARD API ERROR:", error);

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
