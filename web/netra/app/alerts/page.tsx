"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./alerts.module.css";

type AlertItem = {
  id: string;
  title: string;
  detail: string;
  severity: "critical" | "warning" | "info";
  source: string;
  createdAt: string;
  time: string;
};

type RouterLog = {
  [key: string]: unknown;
  time?: string;
  message?: string;
  topics?: string;
  level?: string;
};

export default function AlertsPage() {
  const [events, setEvents] = useState<AlertItem[]>([]);
  const [logs, setLogs] = useState<RouterLog[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadAlerts = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/alerts", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.events)) {
        throw new Error(data.error || "Gagal mengambil event jaringan");
      }
      setEvents(
        data.events.map((event: AlertItem) => ({
          ...event,
          time: new Date(event.createdAt).toLocaleString("id-ID"),
        })),
      );
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gagal mengambil event jaringan",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadLogs = useCallback(async () => {
    try {
      const response = await fetch("/api/alerts/logs", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.logs)) return;
      setLogs(data.logs);
    } catch {
      // Incident data remains usable if the optional log request fails.
    }
  }, []);

  useEffect(() => {
    loadAlerts();
    loadLogs();
    const timer = window.setInterval(() => loadAlerts(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadAlerts, loadLogs]);

  const visibleAlerts = useMemo(
    () =>
      events.filter((alert) => filter === "all" || alert.severity === filter),
    [events, filter],
  );
  const counts = {
    critical: events.filter((alert) => alert.severity === "critical").length,
    warning: events.filter((alert) => alert.severity === "warning").length,
    info: events.filter((alert) => alert.severity === "info").length,
  };

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>NETRA / INCIDENT CENTER</p>
          <h1>Alerts</h1>
          <p className={styles.subtitle}>
            Event jaringan dari router yang perlu dipantau atau ditindaklanjuti.
          </p>
        </div>
        <button
          className={styles.refresh}
          type="button"
          onClick={() => {
            void loadAlerts(true);
            void loadLogs();
          }}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh data"}
        </button>
      </header>

      <div className={styles.stats}>
        <div className={`${styles.stat} ${styles.critical}`}>
          <span>Critical</span>
          <strong>{counts.critical}</strong>
        </div>
        <div className={`${styles.stat} ${styles.warning}`}>
          <span>Warning</span>
          <strong>{counts.warning}</strong>
        </div>
        <div className={`${styles.stat} ${styles.info}`}>
          <span>Info</span>
          <strong>{counts.info}</strong>
        </div>
        <div className={styles.stat}>
          <span>Total events</span>
          <strong>{events.length}</strong>
        </div>
      </div>

      <div className={styles.toolbar}>
        <p>Event terdeteksi dari perubahan kondisi router</p>
        <div className={styles.filters}>
          {["all", "critical", "warning", "info"].map((item) => (
            <button
              key={item}
              type="button"
              className={filter === item ? styles.selected : ""}
              onClick={() => setFilter(item)}
            >
              {item === "all" ? "Semua" : item}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.list}>
        {loading && (
          <div className={styles.message}>Mengambil event dari router...</div>
        )}
        {!loading && error && <div className={styles.message}>{error}</div>}
        {!loading &&
          !error &&
          visibleAlerts.map((alert) => (
            <article className={styles.alert} key={alert.id}>
              <span className={`${styles.signal} ${styles[alert.severity]}`} />
              <div className={styles.content}>
                <div className={styles.alertTop}>
                  <strong>{alert.title}</strong>
                  <time>{alert.time}</time>
                </div>
                <p>{alert.detail}</p>
                <span className={styles.source}>{alert.source}</span>
              </div>
              <span className={`${styles.label} ${styles[alert.severity]}`}>
                {alert.severity}
              </span>
            </article>
          ))}
        {!loading && !error && visibleAlerts.length === 0 && (
          <div className={styles.message}>Belum ada event pada filter ini.</div>
        )}
      </div>
      <div className={styles.logHeader}>
        <div>
          <h2>Recent Router Logs</h2>
          <p>
            Aktivitas mentah terbaru dari MikroTik untuk pemeriksaan detail.
          </p>
        </div>
      </div>
      <div className={styles.logs}>
        {loading && (
          <div className={styles.message}>Mengambil log router...</div>
        )}
        {!loading && !error && logs.length === 0 && (
          <div className={styles.message}>Belum ada log router.</div>
        )}
        {!loading &&
          !error &&
          logs.map((log, index) => (
            <div
              className={styles.logRow}
              key={String(log[".id"] || `${log.time}-${index}`)}
            >
              <time className={styles.logTime}>{String(log.time || "-")}</time>
              <span className={styles.logTopics}>
                {String(log.topics || "system")}
              </span>
              <span className={styles.logMessage}>
                {String(log.message || "-")}
              </span>
            </div>
          ))}
      </div>
      <p className={styles.updated}>
        Data diperbarui otomatis setiap 15 detik. Event pertama menjadi
        baseline; notifikasi dibuat saat kondisi berubah.
      </p>
    </section>
  );
}
