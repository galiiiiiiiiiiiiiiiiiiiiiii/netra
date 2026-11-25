import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getInterfaceTraffic } from "@/lib/mikrotik/client";

const POLL_INTERVAL_MS = 15_000;
const SAMPLE_INTERVAL_MS = 5 * 60 * 1_000;
const MAX_POINTS = 25;
const dataDirectory = path.join(process.cwd(), "data");
const historyFile = path.join(dataDirectory, "traffic-history.json");

export type TrafficPoint = {
  timestamp: number;
  time: string;
  download: number;
  upload: number;
};

type TrafficState = {
  history: TrafficPoint[];
  lastSampleAt: number;
  timer?: ReturnType<typeof setInterval>;
  refreshPromise?: Promise<void>;
};

declare global {
  // eslint-disable-next-line no-var
  var netraTrafficState: TrafficState | undefined;
}

function getState() {
  globalThis.netraTrafficState ??= {
    history: [],
    lastSampleAt: 0,
  };
  return globalThis.netraTrafficState;
}

async function loadHistory() {
  try {
    const content = await readFile(historyFile, "utf8");
    const history = JSON.parse(content) as TrafficPoint[];
    return Array.isArray(history) ? history.slice(-MAX_POINTS) : [];
  } catch {
    return [];
  }
}

async function saveHistory(history: TrafficPoint[]) {
  await mkdir(dataDirectory, { recursive: true });
  await writeFile(historyFile, `${JSON.stringify(history, null, 2)}\n`, "utf8");
}

function selectPrimaryTraffic(
  interfaces: Array<{ name?: string; rx: number; tx: number }>,
) {
  return (
    interfaces.find((item) => item.name === "ether1") ??
    interfaces.reduce(
      (maximum, item) =>
        item.rx + item.tx > maximum.rx + maximum.tx ? item : maximum,
      interfaces[0] ?? { rx: 0, tx: 0 },
    )
  );
}

async function refreshTraffic() {
  const state = getState();
  if (state.refreshPromise) return state.refreshPromise;

  state.refreshPromise = (async () => {
    try {
      const interfaces = await getInterfaceTraffic();
      const primary = selectPrimaryTraffic(interfaces);
      const now = Date.now();

      if (
        now - state.lastSampleAt < SAMPLE_INTERVAL_MS &&
        state.history.length
      ) {
        return;
      }

      const point: TrafficPoint = {
        timestamp: now,
        time: new Date(now).toISOString(),
        download: Number(primary.rx) || 0,
        upload: Number(primary.tx) || 0,
      };

      state.history = [...state.history, point].slice(-MAX_POINTS);
      state.lastSampleAt = now;
      await saveHistory(state.history);
    } catch (error) {
      console.error("TRAFFIC COLLECTOR ERROR:", error);
    } finally {
      state.refreshPromise = undefined;
    }
  })();

  return state.refreshPromise;
}

export async function startTrafficCollector() {
  const state = getState();
  if (!state.history.length) {
    state.history = await loadHistory();
    state.lastSampleAt = state.history.at(-1)?.timestamp ?? 0;
  }

  if (!state.timer) {
    void refreshTraffic();
    state.timer = setInterval(() => void refreshTraffic(), POLL_INTERVAL_MS);
  }
}

export function getTrafficHistory() {
  return getState().history;
}
