"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./traffic.module.css";

type InterfaceTraffic = {
  ".id"?: string;
  name: string;
  comment?: string;
  type?: string;
  running?: string;
  disabled?: string;

  "rx-byte"?: string;
  "tx-byte"?: string;
  "rx-packet"?: string;
  "tx-packet"?: string;
  "rx-bits-per-second"?: string;
  "tx-bits-per-second"?: string;
};

type TrafficInterface = InterfaceTraffic & {
  rxRate: number;
  txRate: number;
};

type TrafficData = {
  success: boolean;
  interfaces: InterfaceTraffic[];
};

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }

  return `${value.toFixed(2)} ${units[index]}`;
}

function formatSpeed(bits: number) {
  if (!bits || bits <= 0) return "0 bps";

  if (bits >= 1_000_000_000) {
    return `${(bits / 1_000_000_000).toFixed(2)} Gbps`;
  }

  if (bits >= 1_000_000) {
    return `${(bits / 1_000_000).toFixed(2)} Mbps`;
  }

  if (bits >= 1_000) {
    return `${(bits / 1_000).toFixed(2)} Kbps`;
  }

  return `${Math.round(bits)} bps`;
}

function toNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export default function TrafficPage() {
  const [interfaces, setInterfaces] = useState<TrafficInterface[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const previousRef = useRef<
    Map<string, { rx: number; tx: number; time: number }>
  >(new Map());

  const loadTraffic = useCallback(async () => {
    try {
      const res = await fetch("/api/mikrotik/traffic", {
        cache: "no-store",
      });

      const data: TrafficData = await res.json();

      if (!res.ok || !data.success) {
        throw new Error("Gagal mengambil data traffic");
      }

      const now = Date.now();

      const result: TrafficInterface[] = data.interfaces.map((item) => {
        const rx = toNumber(item["rx-byte"]);
        const tx = toNumber(item["tx-byte"]);

        const previous = previousRef.current.get(item.name);

        let rxRate = 0;
        let txRate = 0;

        if (previous) {
          const seconds = (now - previous.time) / 1000;

          if (seconds > 0 && seconds < 10) {
            const rxDiff = rx - previous.rx;
            const txDiff = tx - previous.tx;

            if (rxDiff >= 0) {
              rxRate = (rxDiff * 8) / seconds;
            }

            if (txDiff >= 0) {
              txRate = (txDiff * 8) / seconds;
            }
          }
        }

        const monitoredRx = Number(item["rx-bits-per-second"]);
        const monitoredTx = Number(item["tx-bits-per-second"]);

        if (Number.isFinite(monitoredRx)) {
          rxRate = monitoredRx;
        }

        if (Number.isFinite(monitoredTx)) {
          txRate = monitoredTx;
        }

        previousRef.current.set(item.name, {
          rx,
          tx,
          time: now,
        });

        return {
          ...item,
          rxRate,
          txRate,
        };
      });

      setInterfaces(result);
      setError("");
    } catch (err) {
      console.error("TRAFFIC:", err);
      setError(
        err instanceof Error ? err.message : "Gagal mengambil data traffic",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTraffic();

    const interval = setInterval(loadTraffic, 1_000);

    return () => clearInterval(interval);
  }, [loadTraffic]);

  const primaryInterface =
    interfaces.find((item) => item.name === "ether1") ??
    interfaces.reduce(
      (maximum, item) =>
        item.rxRate + item.txRate > maximum.rxRate + maximum.txRate
          ? item
          : maximum,
      interfaces[0] ?? null,
    );

  const totalRx = primaryInterface?.rxRate ?? 0;
  const totalTx = primaryInterface?.txRate ?? 0;
  const totalRxBytes = toNumber(primaryInterface?.["rx-byte"]);
  const totalTxBytes = toNumber(primaryInterface?.["tx-byte"]);

  const active = interfaces.filter(
    (item) => item.running === "true" && item.disabled !== "true",
  ).length;

  return (
    <main className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Traffic</h1>
          <p>Real-time monitoring traffic interface MikroTik</p>
        </div>

        <button
          className={styles.refresh}
          onClick={loadTraffic}
          disabled={loading}
        >
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className={styles.error}>
          <strong>Gagal mengambil data traffic.</strong>
          <span>{error}</span>
        </div>
      )}

      <section className={styles.stats}>
        <div className={styles.card}>
          <span className={styles.label}>DOWNLOAD</span>
          <strong className={styles.download}>{formatSpeed(totalRx)}</strong>
          <small>Total RX traffic</small>
          <div className={styles.total}>{formatBytes(totalRxBytes)}</div>
        </div>

        <div className={styles.card}>
          <span className={styles.label}>UPLOAD</span>
          <strong className={styles.upload}>{formatSpeed(totalTx)}</strong>
          <small>Total TX traffic</small>
          <div className={styles.total}>{formatBytes(totalTxBytes)}</div>
        </div>

        <div className={styles.card}>
          <span className={styles.label}>INTERFACES</span>
          <strong>{interfaces.length}</strong>
          <small>Total interface</small>
        </div>

        <div className={styles.card}>
          <span className={styles.label}>ACTIVE</span>
          <strong>{active}</strong>
          <small>Interface aktif</small>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Interface Traffic</h2>
            <p>Traffic RX dan TX setiap interface</p>
          </div>

          <span>{interfaces.length} interface</span>
        </div>

        <div className={styles.tableWrapper}>
          <table>
            <thead>
              <tr>
                <th>INTERFACE</th>
                <th>STATUS</th>
                <th>DOWNLOAD</th>
                <th>UPLOAD</th>
                <th>RX PACKET</th>
                <th>TX PACKET</th>
              </tr>
            </thead>

            <tbody>
              {interfaces.map((item) => {
                const online =
                  item.running === "true" && item.disabled !== "true";

                return (
                  <tr key={item.name}>
                    <td className={styles.interfaceName}>
                      {item.comment || item.name}
                    </td>

                    <td>
                      <span className={online ? styles.online : styles.offline}>
                        <i />
                        {online ? "ONLINE" : "OFFLINE"}
                      </span>
                    </td>

                    <td>
                      <strong>{formatSpeed(item.rxRate)}</strong>
                      <small>{formatBytes(toNumber(item["rx-byte"]))}</small>
                    </td>

                    <td>
                      <strong>{formatSpeed(item.txRate)}</strong>
                      <small>{formatBytes(toNumber(item["tx-byte"]))}</small>
                    </td>

                    <td>
                      {toNumber(item["rx-packet"]).toLocaleString("id-ID")}
                    </td>

                    <td>
                      {toNumber(item["tx-packet"]).toLocaleString("id-ID")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
