import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type PersistedAlertState = {
  baselineReady?: boolean;
  interfaces: Record<string, string>;
  ppp: Record<string, string>;
  duplicateIps: string[];
  events: Array<{
    id: string;
    title: string;
    detail: string;
    severity: "critical" | "warning" | "info";
    source: "PPP" | "Interface" | "IP audit";
    createdAt: string;
    fingerprint: string;
  }>;
};

const dataDirectory = path.join(process.cwd(), "data");
const stateFile = path.join(dataDirectory, "alerts.json");

function emptyState(): PersistedAlertState {
  return {
    baselineReady: false,
    interfaces: {},
    ppp: {},
    duplicateIps: [],
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
