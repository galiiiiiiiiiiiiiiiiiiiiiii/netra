import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PersistedAlertState = {
  baselineReady?: boolean;
  routerOnline?: boolean;
  routerFailureStreak?: number;
  routerSuccessStreak?: number;
  interfaces: Record<string, string>;
  ppp: Record<string, string>;
  duplicateIps: string[];
  routerLogFingerprints?: string[];
  routerLogBaselineReady?: boolean;
  events: Array<{
    id: string;
    title: string;
    detail: string;
    severity: "critical" | "warning" | "info";
    source: "PPP" | "Interface" | "IP audit" | "Router";
    createdAt: string;
    fingerprint: string;
  }>;
};

const dataDirectory = path.join(process.cwd(), "data");
const stateFile = path.join(dataDirectory, "alerts.json");

function emptyState(): PersistedAlertState {
  return {
    baselineReady: false,
    routerOnline: undefined,
    routerFailureStreak: 0,
    routerSuccessStreak: 0,
    interfaces: {},
    ppp: {},
    duplicateIps: [],
    routerLogFingerprints: [],
    routerLogBaselineReady: false,
    events: [],
  };
}

function isState(value: unknown): value is PersistedAlertState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<PersistedAlertState>;
  return (
    typeof state.interfaces === "object" &&
    typeof state.ppp === "object" &&
    Array.isArray(state.duplicateIps) &&
    Array.isArray(state.events)
  );
}

export async function loadAlertState() {
  try {
    const content = await readFile(stateFile, "utf8");
    const parsed: unknown = JSON.parse(content);
    return isState(parsed) ? parsed : emptyState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("NETRA ALERT STATE READ ERROR:", error);
    }
    return emptyState();
  }
}

export async function saveAlertState(state: PersistedAlertState) {
  try {
    await mkdir(dataDirectory, { recursive: true });
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch (error) {
    console.error("NETRA ALERT STATE WRITE ERROR:", error);
  }
}
