import { getAlertSnapshot } from "@/lib/mikrotik/client";
import {
  loadAlertState,
  saveAlertState,
  type PersistedAlertState,
} from "@/lib/alerts/store";

export type AlertSeverity = "critical" | "warning" | "info";

export type AlertEvent = {
  id: string;
  title: string;
  detail: string;
  severity: AlertSeverity;
  source: "PPP" | "Interface" | "IP audit";
  createdAt: string;
  fingerprint: string;
};

type AlertState = PersistedAlertState;

type RouterInterface = {
  [key: string]: unknown;
  name?: string;
  running?: string | boolean;
  disabled?: string | boolean;
};

type PPPUser = {
  name?: string;
  status?: string;
  ip?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var netraAlertState: AlertState | undefined;
  // eslint-disable-next-line no-var
  var netraAlertCollection:
    | ReturnType<typeof collectAlertEventsInternal>
    | undefined;
}

function isTrue(value: unknown) {
  return value === true || value === "true";
}

function addEvent(
  state: AlertState,
  event: Omit<AlertEvent, "id" | "createdAt">,
) {
  const nextEvent: AlertEvent = {
    ...event,
    id: `${Date.now()}-${state.events.length}`,
    createdAt: new Date().toISOString(),
  };

  state.events.unshift(nextEvent);
  state.events = state.events.slice(0, 100);
}

async function collectAlertEventsInternal() {
  const { interfaces: rawInterfaces, users: rawUsers } =
    await getAlertSnapshot();
  globalThis.netraAlertState ??= await loadAlertState();
  const state = globalThis.netraAlertState;
  const nextInterfaces: Record<string, string> = {};
  const nextPPP: Record<string, string> = {};
  const baselineReady = state.baselineReady === true;
  const knownEventIds = new Set(state.events.map((event) => event.id));

  for (const rawInterface of rawInterfaces as RouterInterface[]) {
    const name = String(rawInterface.name || rawInterface[".id"] || "unknown");
    const status = isTrue(rawInterface.disabled)
      ? "disabled"
      : isTrue(rawInterface.running)
        ? "running"
        : "down";
    const previousStatus = state.interfaces[name];
    nextInterfaces[name] = status;

    if (!previousStatus) {
      if (baselineReady) {
        addEvent(state, {
          fingerprint: `interface:${name}:added`,
          title: `Interface ${name} ditambahkan`,
          detail: `Interface baru terdeteksi dengan status ${status}.`,
          severity: "info",
          source: "Interface",
        });
      }
      continue;
    }

    if (previousStatus === status) continue;

    const interfaceAction =
      status === "disabled"
        ? "dinonaktifkan"
        : previousStatus === "disabled"
          ? "diaktifkan"
          : status === "down"
            ? "down"
            : "kembali running";

    addEvent(state, {
      fingerprint: `interface:${name}:${status}`,
      title: `Interface ${name} ${interfaceAction}`,
      detail:
        status === "running"
          ? "Interface kembali aktif."
          : status === "disabled"
            ? "Interface dinonaktifkan dari konfigurasi router."
            : "Indikasi kabel, perangkat upstream, atau link lawan tidak aktif.",
      severity: status === "running" ? "info" : "critical",
      source: "Interface",
    });
  }

  if (baselineReady) {
    for (const name of Object.keys(state.interfaces)) {
      if (nextInterfaces[name]) continue;
      addEvent(state, {
        fingerprint: `interface:${name}:removed`,
        title: `Interface ${name} dihapus`,
        detail:
          "Interface sebelumnya ada, tetapi tidak lagi ditemukan di router.",
        severity: "warning",
        source: "Interface",
      });
    }
  }

  for (const rawUser of rawUsers as PPPUser[]) {
    const name = String(rawUser.name || "unknown");
    const status = String(rawUser.status || "offline");
    const previousStatus = state.ppp[name];
    nextPPP[name] = status;

    if (!previousStatus) {
      if (baselineReady) {
        addEvent(state, {
          fingerprint: `ppp:${name}:added`,
          title: `Secret ${name} ditambahkan`,
          detail: `Akun PPP baru terdeteksi dengan status ${status}.`,
          severity: "info",
          source: "PPP",
        });
      }
      continue;
    }

    if (previousStatus === status) continue;

    const pppAction =
      status === "disabled"
        ? "dinonaktifkan"
        : previousStatus === "disabled"
          ? "diaktifkan"
          : `berubah menjadi ${status}`;

    addEvent(state, {
      fingerprint: `ppp:${name}:${status}`,
      title: `Secret ${name} ${pppAction}`,
      detail:
        status === "online"
          ? "Koneksi PPP berhasil aktif kembali."
          : status === "disabled"
            ? "Akun PPP dinonaktifkan dari konfigurasi router."
            : previousStatus === "disabled"
              ? "Akun PPP kembali aktif, tetapi status koneksinya belum online."
              : "Indikasi LOS, perangkat pelanggan mati, atau link access point terputus.",
      severity: status === "online" ? "info" : "warning",
      source: "PPP",
    });
  }

  if (baselineReady) {
    for (const name of Object.keys(state.ppp)) {
      if (nextPPP[name]) continue;
      addEvent(state, {
        fingerprint: `ppp:${name}:removed`,
        title: `Secret ${name} dihapus`,
        detail:
          "Akun PPP sebelumnya ada, tetapi tidak lagi ditemukan di router.",
        severity: "warning",
        source: "PPP",
      });
    }
  }

  const ipOwners = new Map<string, string[]>();
  for (const rawUser of rawUsers as PPPUser[]) {
    const ip = String(rawUser.ip || "").trim();
    const name = String(rawUser.name || "unknown");
    if (!ip || rawUser.status !== "online") continue;
    ipOwners.set(ip, [...(ipOwners.get(ip) || []), name]);
  }

  const nextDuplicateIps = Array.from(ipOwners.entries())
    .filter(([, owners]) => owners.length > 1)
    .map(([ip]) => ip)
    .sort();

  for (const ip of nextDuplicateIps) {
    if (state.duplicateIps.includes(ip)) continue;
    const owners = ipOwners.get(ip) || [];
    addEvent(state, {
      fingerprint: `duplicate-ip:${ip}`,
      title: "Duplicate IP terdeteksi",
      detail: `${ip} sedang digunakan oleh ${owners.join(" dan ")}. Segera periksa konfigurasi IP pelanggan.`,
      severity: "warning",
      source: "IP audit",
    });
  }

  state.interfaces = nextInterfaces;
  state.ppp = nextPPP;
  state.duplicateIps = nextDuplicateIps;
  state.baselineReady = true;
  await saveAlertState(state);

  return {
    initialized: !baselineReady,
    events: state.events,
    newEvents: state.events.filter((event) => !knownEventIds.has(event.id)),
  };
}

export async function collectAlertEvents() {
  if (!globalThis.netraAlertCollection) {
    globalThis.netraAlertCollection = collectAlertEventsInternal().finally(
      () => {
        globalThis.netraAlertCollection = undefined;
      },
    );
  }

  return globalThis.netraAlertCollection;
}
