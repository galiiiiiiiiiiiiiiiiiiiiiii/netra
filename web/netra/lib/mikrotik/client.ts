import { MikrotikAPI } from "@fibercom/routeros-api";

let sharedClient: MikrotikAPI | undefined;
let sharedConnection: Promise<MikrotikAPI> | undefined;
let operationQueue = Promise.resolve();
const OPERATION_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(
      () => reject(new Error("MikroTik request timed out")),
      timeoutMs,
    );
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function resetClient(client: MikrotikAPI) {
  sharedClient = undefined;

  try {
    await withTimeout(client.close(), 1_000);
  } catch {
    // The stale socket is discarded even if RouterOS does not close cleanly.
  }
}

export function createMikrotikClient() {
  sharedClient ??= new MikrotikAPI({
    host: process.env.MIKROTIK_HOST!,
    port: Number(process.env.MIKROTIK_PORT),
    user: process.env.MIKROTIK_USER!,
    password: process.env.MIKROTIK_PASSWORD!,
    timeout: 10,
  });

  return sharedClient;
}

async function getConnectedClient() {
  const client = createMikrotikClient();

  if (client.connected) return client;
  if (!sharedConnection) {
    sharedConnection = withTimeout(client.connect(), OPERATION_TIMEOUT_MS)
      .then(() => client)
      .catch((error) => {
        sharedClient = undefined;
        throw error;
      })
      .finally(() => {
        sharedConnection = undefined;
      });
  }

  return sharedConnection;
}

export async function withMikrotikClient<T>(
  operation: (client: MikrotikAPI) => Promise<T>,
) {
  const queuedOperation = operationQueue.then(async () => {
    const client = await getConnectedClient();

    try {
      return await withTimeout(operation(client), OPERATION_TIMEOUT_MS);
    } catch (error) {
      await resetClient(client);
      throw error;
    }
  });

  operationQueue = queuedOperation.then(
    () => undefined,
    () => undefined,
  );
  return queuedOperation;
}

export async function getRouterStatus() {
  return withMikrotikClient(async (api) => {
    const identity = await api.getSystemIdentity();
    const resources = await api.getSystemResources();

    return {
      identity,
      resources: resources[0],
    };
  });
}

export async function getRouterLogs() {
  return withMikrotikClient((api) => api.write("/log/print"));
}

export async function getInterfaces() {
  return withMikrotikClient((api) => api.getInterfaces());
}

export async function getAlertSnapshot() {
  return withMikrotikClient(async (api) => {
    const [interfaces, secrets, active] = await Promise.all([
      api.getInterfaces(),
      api.write("/ppp/secret/print"),
      api.write("/ppp/active/print"),
    ]);
    const activeMap = new Map(
      (active as any[]).map((user) => [user.name, user]),
    );

    const users = (secrets as any[]).map((secret) => {
      const onlineUser = activeMap.get(secret.name);

      return {
        id: secret.id,
        name: secret.name,
        status:
          secret.disabled === "true"
            ? "disabled"
            : onlineUser
              ? "online"
              : "offline",
        profile: secret.profile || "",
        ip: onlineUser?.address || secret["remote-address"] || "",
        uptime: onlineUser?.uptime || "",
        callerId: onlineUser?.["caller-id"] || "",
        lastDisconnectReason: secret["last-disconnect-reason"] || "",
        comment: secret.comment || "",
      };
    });

    return { interfaces, users };
  });
}

export async function getInterfaceTraffic() {
  return withMikrotikClient(async (api) => {
    const interfaces = await api.write("/interface/print", [
      "=.proplist=.id,name,running,disabled",
    ]);

    const traffic = [];

    for (const iface of interfaces as any[]) {
      const stats = await api.write("/interface/monitor-traffic", [
        `=interface=${iface.name}`,
        "=once=yes",
      ]);

      const data = stats?.[0] || {};

      traffic.push({
        id: iface[".id"],
        name: iface.name || "-",
        status:
          iface.disabled === "true"
            ? "down"
            : iface.running === "true"
              ? "up"
              : "down",
        rx: Number(data["rx-bits-per-second"] || 0),
        tx: Number(data["tx-bits-per-second"] || 0),
      });
    }

    return traffic;
  });
}

export async function getPPPActive() {
  return withMikrotikClient((api) => api.write("/ppp/active/print"));
}

export async function getPPPSecrets() {
  return withMikrotikClient((api) => api.write("/ppp/secret/print"));
}

export async function getPPPStatus() {
  return withMikrotikClient(async (api) => {
    const secrets = await api.write("/ppp/secret/print");
    const active = await api.write("/ppp/active/print");

    const activeMap = new Map(active.map((user: any) => [user.name, user]));

    return secrets.map((secret: any) => {
      const onlineUser = activeMap.get(secret.name);

      return {
        id: secret.id,
        name: secret.name,
        status:
          secret.disabled === "true"
            ? "disabled"
            : onlineUser
              ? "online"
              : "offline",

        profile: secret.profile || "",
        ip: onlineUser?.address || secret["remote-address"] || "",
        uptime: onlineUser?.uptime || "",
        callerId: onlineUser?.["caller-id"] || "",
        lastDisconnectReason: secret["last-disconnect-reason"] || "",
        comment: secret.comment || "",
      };
    });
  });
}

function ipv4ToNumber(ip: string) {
  const parts = ip.split(".").map(Number);

  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }

  return parts[0] * 256 ** 3 + parts[1] * 256 ** 2 + parts[2] * 256 + parts[3];
}

function numberToIPv4(value: number) {
  return [
    Math.floor(value / 256 ** 3) % 256,
    Math.floor(value / 256 ** 2) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join(".");
}

export async function getPPPIPPool() {
  return withMikrotikClient(async (api) => {
    const secrets = await api.write("/ppp/secret/print");
    const secretPoolNames = new Set(
      (secrets as any[])
        .map((secret) => String(secret["remote-address"] || "").trim())
        .filter(Boolean),
    );
    const pools = await api.write("/ip/pool/print");
    const addresses = new Set<string>();

    for (const pool of pools as any[]) {
      if (!secretPoolNames.has(String(pool.name || "").trim())) {
        continue;
      }

      const ranges = String(pool.ranges || "").split(",");

      for (const range of ranges) {
        const [startIP, endIP = startIP] = range.trim().split("-");
        const start = ipv4ToNumber(startIP);
        const end = ipv4ToNumber(endIP);

        if (start === null || end === null || end < start) {
          continue;
        }

        for (let value = start; value <= end; value++) {
          addresses.add(numberToIPv4(value));
        }
      }
    }

    return Array.from(addresses).sort((left, right) => {
      return (ipv4ToNumber(left) ?? 0) - (ipv4ToNumber(right) ?? 0);
    });
  });
}
