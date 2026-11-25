"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./interfaces.module.css";

type RouterInterface = {
  [key: string]: unknown;
  name?: string;
  type?: string;
  running?: string | boolean;
  disabled?: string | boolean;
  mtu?: string | number;
  "mac-address"?: string;
};

function isTrue(value: unknown) {
  return value === true || value === "true";
}

function interfaceStatus(item: RouterInterface) {
  if (isTrue(item.disabled)) return "disabled";
  if (isTrue(item.running)) return "running";
  return "down";
}

function statusLabel(status: string) {
  return status === "running"
    ? "Running"
    : status === "disabled"
      ? "Disabled"
      : "Down";
}

export default function InterfacesPage() {
  const [interfaces, setInterfaces] = useState<RouterInterface[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadInterfaces = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/mikrotik/interfaces", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.interfaces)) {
        throw new Error(data.error || "Gagal mengambil data interface");
      }
      setInterfaces(data.interfaces);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gagal mengambil data interface",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadInterfaces();
    const timer = window.setInterval(() => loadInterfaces(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadInterfaces]);

  const counts = useMemo(() => {
    return interfaces.reduce(
      (result, item) => {
        result.total += 1;
        result[interfaceStatus(item)] += 1;
        return result;
      },
      { total: 0, running: 0, down: 0, disabled: 0 } as Record<string, number>,
    );
  }, [interfaces]);

  const visibleInterfaces = interfaces.filter((item) => {
    const status = interfaceStatus(item);
    const name = String(item.name || "").toLowerCase();
    const type = String(item.type || "").toLowerCase();
    return (
      (!query ||
        name.includes(query.toLowerCase()) ||
        type.includes(query.toLowerCase())) &&
      (filter === "all" || status === filter)
    );
  });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NETWORK / MONITORING</p>
          <h1>Interfaces</h1>
          <p className={styles.subtitle}>
            Pantau status dan identitas setiap interface MikroTik.
          </p>
        </div>
        <button
          className={styles.refresh}
          type="button"
          onClick={() => loadInterfaces(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh data"}
        </button>
      </header>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span>Total interface</span>
          <strong>{counts.total}</strong>
        </div>
        <div className={`${styles.stat} ${styles.green}`}>
          <span>Running</span>
          <strong>{counts.running}</strong>
        </div>
        <div className={`${styles.stat} ${styles.red}`}>
          <span>Down</span>
          <strong>{counts.down}</strong>
        </div>
        <div className={`${styles.stat} ${styles.muted}`}>
          <span>Disabled</span>
          <strong>{counts.disabled}</strong>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari nama atau tipe interface..."
        />
        <div className={styles.filters}>
          {["all", "running", "down", "disabled"].map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? styles.selected : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "Semua" : statusLabel(item)}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr className={styles.tableRow}>
              <th className={styles.tableHeadCell}>Interface</th>
              <th className={styles.tableHeadCell}>Type</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>MAC address</th>
              <th className={styles.tableHeadCell}>MTU</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {loading && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={5}
                >
                  Mengambil data interface...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={5}
                >
                  {error}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              visibleInterfaces.map((item, index) => {
                const status = interfaceStatus(item);
                return (
                  <tr
                    className={styles.tableRow}
                    key={String(item[".id"] || item.name || index)}
                  >
                    <td className={`${styles.tableCell} ${styles.name}`}>
                      {String(item.name || "-")}
                    </td>
                    <td className={styles.tableCell}>
                      {String(item.type || "-")}
                    </td>
                    <td className={styles.tableCell}>
                      <span className={`${styles.badge} ${styles[status]}`}>
                        <i />
                        {statusLabel(status)}
                      </span>
                    </td>
                    <td className={`${styles.tableCell} ${styles.mono}`}>
                      {String(item["mac-address"] || "-")}
                    </td>
                    <td className={styles.tableCell}>
                      {String(item.mtu || "-")}
                    </td>
                  </tr>
                );
              })}
            {!loading && !error && visibleInterfaces.length === 0 && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={5}
                >
                  Tidak ada interface yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.updated}>
        Data diperbarui otomatis setiap 15 detik.
      </p>
    </section>
  );
}
