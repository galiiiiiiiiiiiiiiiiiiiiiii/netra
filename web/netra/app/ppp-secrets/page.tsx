"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ppp-secrets.module.css";

type PPPSecret = {
  id?: string;
  name?: string;
  status?: "online" | "offline" | "disabled";
  profile?: string;
  ip?: string;
  uptime?: string;
  callerId?: string;
  lastDisconnectReason?: string;
  comment?: string;
};

const filters = ["all", "online", "offline", "disabled"] as const;

function statusLabel(status: string) {
  return status === "online"
    ? "Online"
    : status === "disabled"
      ? "Disabled"
      : "Offline";
}

export default function PPPSecretsPage() {
  const [users, setUsers] = useState<PPPSecret[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof filters)[number]>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadUsers = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setError("");

    try {
      const response = await fetch("/api/mikrotik/ppp/status", {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.users)) {
        throw new Error(data.error || "Gagal mengambil data PPP secrets");
      }
      setUsers(data.users);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Gagal mengambil data PPP secrets",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
    const timer = window.setInterval(() => loadUsers(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadUsers]);

  const summary = useMemo(
    () => ({
      total: users.length,
      online: users.filter((user) => user.status === "online").length,
      offline: users.filter((user) => user.status === "offline").length,
      disabled: users.filter((user) => user.status === "disabled").length,
    }),
    [users],
  );

  const visibleUsers = users.filter((user) => {
    const username = String(user.name || "").toLowerCase();
    const profile = String(user.profile || "").toLowerCase();
    const status = user.status || "offline";
    return (
      (!query ||
        username.includes(query.toLowerCase()) ||
        profile.includes(query.toLowerCase())) &&
      (filter === "all" || filter === status)
    );
  });

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>PPPoE / ACCOUNTS</p>
          <h1>PPP Secrets</h1>
          <p className={styles.subtitle}>
            Daftar akun PPPoE dan status koneksi pelanggan.
          </p>
        </div>
        <button
          className={styles.refresh}
          type="button"
          onClick={() => loadUsers(true)}
          disabled={refreshing}
        >
          {refreshing ? "Refreshing..." : "Refresh data"}
        </button>
      </header>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <span>Total secrets</span>
          <strong>{summary.total}</strong>
        </div>
        <div className={`${styles.stat} ${styles.online}`}>
          <span>Online</span>
          <strong>{summary.online}</strong>
        </div>
        <div className={`${styles.stat} ${styles.offline}`}>
          <span>Offline</span>
          <strong>{summary.offline}</strong>
        </div>
        <div className={`${styles.stat} ${styles.disabled}`}>
          <span>Disabled</span>
          <strong>{summary.disabled}</strong>
        </div>
      </div>

      <div className={styles.toolbar}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cari username atau profile..."
        />
        <div className={styles.filters}>
          {filters.map((item) => (
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
              <th className={styles.tableHeadCell}>Username</th>
              <th className={styles.tableHeadCell}>Status</th>
              <th className={styles.tableHeadCell}>Profile</th>
              <th className={styles.tableHeadCell}>IP address</th>
              <th className={styles.tableHeadCell}>Caller ID</th>
              <th className={styles.tableHeadCell}>Uptime</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={6}
                >
                  Mengambil data PPP secrets...
                </td>
              </tr>
            )}
            {!loading && error && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={6}
                >
                  {error}
                </td>
              </tr>
            )}
            {!loading &&
              !error &&
              visibleUsers.map((user, index) => {
                const status = user.status || "offline";
                return (
                  <tr
                    className={styles.tableRow}
                    key={user.id || user.name || index}
                  >
                    <td className={`${styles.tableCell} ${styles.name}`}>
                      {user.name || "-"}
                    </td>
                    <td className={styles.tableCell}>
                      <span className={`${styles.badge} ${styles[status]}`}>
                        <i />
                        {statusLabel(status)}
                      </span>
                    </td>
                    <td className={styles.tableCell}>{user.profile || "-"}</td>
                    <td className={`${styles.tableCell} ${styles.mono}`}>
                      {user.ip || "-"}
                    </td>
                    <td className={`${styles.tableCell} ${styles.mono}`}>
                      {user.callerId || "-"}
                    </td>
                    <td className={styles.tableCell}>{user.uptime || "-"}</td>
                  </tr>
                );
              })}
            {!loading && !error && visibleUsers.length === 0 && (
              <tr className={styles.tableRow}>
                <td
                  className={`${styles.tableCell} ${styles.message}`}
                  colSpan={6}
                >
                  Tidak ada secret yang cocok.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className={styles.updated}>
        Password tidak ditampilkan. Data diperbarui otomatis setiap 15 detik.
      </p>
    </section>
  );
}
