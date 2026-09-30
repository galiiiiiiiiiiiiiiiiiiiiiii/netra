"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PPPUser = {
  name: string;
  status: string;
  profile?: string;
  ip?: string;
  uptime?: string;
};

type AuditIP = {
  ip: string;
  status: "ONLINE" | "OFFLINE" | "EMPTY";
  customer: string;
  profile: string;
};

type IPConflict = {
  ip: string;
  customers: string[];
  count: number;
};

export default function IPAuditPage() {
  const [users, setUsers] = useState<PPPUser[]>([]);
  const [poolIps, setPoolIps] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "ALL" | "ONLINE" | "OFFLINE" | "EMPTY"
  >("ALL");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const res = await fetch("/api/mikrotik/ppp/status", {
        cache: "no-store",
      });

      if (!res.ok) {
        throw new Error("Gagal mengambil data MikroTik");
      }

      const data = await res.json();

      if (!data.success || !Array.isArray(data.users)) {
        throw new Error("Format data MikroTik tidak valid");
      }

      setUsers(data.users);
      setPoolIps(Array.isArray(data.poolIps) ? data.poolIps : []);
    } catch (err) {
      console.error(err);
      setError(
        err instanceof Error ? err.message : "Gagal mengambil data MikroTik",
      );
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const normalizedUsers = useMemo(() => {
    return users
      .map((user) => ({
        ...user,
        ip: String(user.ip || "").trim(),
        name: String(user.name || "").trim(),
        profile: String(user.profile || "").trim(),
        status: String(user.status || "").trim(),
      }))
      .filter((user) => user.ip);
  }, [users]);

  const auditData = useMemo<AuditIP[]>(() => {
    const map = new Map<string, PPPUser>();

    normalizedUsers.forEach((user) => {
      if (user.ip) {
        map.set(user.ip, user);
      }
    });

    const result: AuditIP[] = [];

    const ips =
      poolIps.length > 0 ? poolIps : normalizedUsers.map((user) => user.ip!);

    ips.forEach((ip) => {
      const user = map.get(ip);

      if (!user) {
        result.push({
          ip,
          status: "EMPTY",
          customer: "-",
          profile: "-",
        });

        return;
      }

      const status =
        String(user.status).toLowerCase() === "online" ? "ONLINE" : "OFFLINE";

      result.push({
        ip,
        status,
        customer: user.name || "-",
        profile: user.profile || "-",
      });
    });

    return result;
  }, [normalizedUsers, poolIps]);

  const poolLabel =
    poolIps.length > 0
      ? `${poolIps[0]} — ${poolIps[poolIps.length - 1]}`
      : "IP yang memiliki data PPP";

  const onlineCount = auditData.filter(
    (item) => item.status === "ONLINE",
  ).length;

  const offlineCount = auditData.filter(
    (item) => item.status === "OFFLINE",
  ).length;

  const emptyCount = auditData.filter((item) => item.status === "EMPTY").length;

  const conflictData = useMemo<IPConflict[]>(() => {
    const map = new Map<string, string[]>();

    normalizedUsers.forEach((user) => {
      if (!user.ip) return;

      const current = map.get(user.ip) || [];

      current.push(user.name || "-");

      map.set(user.ip, current);
    });

    return Array.from(map.entries())
      .filter(([, customers]) => customers.length > 1)
      .map(([ip, customers]) => ({
        ip,
        customers,
        count: customers.length,
      }));
  }, [normalizedUsers]);

  const gapData = useMemo(() => {
    const usedIndexes = auditData
      .filter((item) => item.status !== "EMPTY")
      .map((item) => Number(item.ip.split(".").pop()));

    if (usedIndexes.length < 2) {
      return [];
    }

    const min = Math.min(...usedIndexes);
    const max = Math.max(...usedIndexes);

    return auditData.filter((item) => {
      const lastOctet = Number(item.ip.split(".").pop());

      return item.status === "EMPTY" && lastOctet > min && lastOctet < max;
    });
  }, [auditData]);

  const filteredData = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return auditData.filter((item) => {
      const matchesStatus =
        statusFilter === "ALL" || item.status === statusFilter;

      if (!matchesStatus) {
        return false;
      }

      if (!keyword) {
        return true;
      }

      return (
        item.ip.toLowerCase().includes(keyword) ||
        item.customer.toLowerCase().includes(keyword) ||
        item.profile.toLowerCase().includes(keyword)
      );
    });
  }, [auditData, search, statusFilter]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <Link href="/" className="back-button">
            ← Back
          </Link>

          <h1 className="page-title">IP Audit</h1>

          <p className="page-subtitle">
            Audit penggunaan IP address pada PPP customer
          </p>
        </div>

        <button type="button" onClick={loadData} disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {error && <div className="audit-error">{error}</div>}

      <div className="cards audit-summary">
        <div className="card">
          <div className="card-label">Online</div>

          <div className="card-value online-value">
            {loading ? "—" : onlineCount}
          </div>

          <div className="card-description">customer sedang terhubung</div>
        </div>

        <div className="card">
          <div className="card-label">Offline</div>

          <div className="card-value offline-value">
            {loading ? "—" : offlineCount}
          </div>

          <div className="card-description">terdaftar tetapi tidak aktif</div>
        </div>

        <div className="card">
          <div className="card-label">Empty</div>

          <div className="card-value">{loading ? "—" : emptyCount}</div>

          <div className="card-description">IP belum digunakan</div>
        </div>

        <div className="card">
          <div className="card-label">Total IP</div>

          <div className="card-value">{auditData.length}</div>

          <div className="card-description">{poolLabel}</div>
        </div>
      </div>

      {/* IP CONFLICT */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">IP Conflict Detection</h2>

            <div className="panel-subtitle">
              IP yang digunakan oleh lebih dari satu PPP customer
            </div>
          </div>

          <div className="gap-count">
            {loading ? "—" : `${conflictData.length} conflict`}
          </div>
        </div>

        {loading ? (
          <div className="audit-empty-state">Memeriksa IP conflict...</div>
        ) : conflictData.length === 0 ? (
          <div className="audit-empty-state">Tidak ditemukan IP conflict.</div>
        ) : (
          <div className="conflict-list">
            {conflictData.map((item) => (
              <div key={item.ip} className="conflict-item">
                <div>
                  <div className="gap-ip">{item.ip}</div>

                  <div className="gap-description">
                    {item.customers.join(", ")}
                  </div>
                </div>

                <span className="conflict-badge">{item.count} CUSTOMER</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* IP GAP */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">IP Gap Detection</h2>

            <div className="panel-subtitle">
              Rentang IP yang kosong di antara IP yang sudah digunakan
            </div>
          </div>

          <div className="gap-count">
            {loading ? "—" : `${gapData.length} gap`}
          </div>
        </div>

        {loading ? (
          <div className="audit-empty-state">
            Mengambil data dari MikroTik...
          </div>
        ) : gapData.length === 0 ? (
          <div className="audit-empty-state">Tidak ditemukan IP gap.</div>
        ) : (
          <div className="gap-grid">
            {gapData.map((item) => (
              <div key={item.ip} className="gap-item">
                <div>
                  <div className="gap-ip">{item.ip}</div>

                  <div className="gap-description">
                    IP kosong di dalam range
                  </div>
                </div>

                <span className="badge">EMPTY</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* FULL IP AUDIT */}
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">IP Address Audit</h2>

            <div className="panel-subtitle">{poolLabel}</div>
          </div>
        </div>

        <div className="audit-toolbar">
          <input
            type="text"
            placeholder="Search IP, customer, atau profile..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <select
            value={statusFilter}
            onChange={(e) =>
              setStatusFilter(
                e.target.value as "ALL" | "ONLINE" | "OFFLINE" | "EMPTY",
              )
            }
          >
            <option value="ALL">All Status</option>
            <option value="ONLINE">Online</option>
            <option value="OFFLINE">Offline</option>
            <option value="EMPTY">Empty</option>
          </select>

          {(search || statusFilter !== "ALL") && (
            <button
              type="button"
              className="clear-filter"
              onClick={() => {
                setSearch("");
                setStatusFilter("ALL");
              }}
            >
              Clear
            </button>
          )}
        </div>

        {!loading && (
          <div className="audit-result-info">
            Menampilkan <strong>{filteredData.length}</strong> dari{" "}
            <strong>{auditData.length}</strong> IP
          </div>
        )}

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>IP Address</th>
                <th>Status</th>
                <th>Customer</th>
                <th>Profile</th>
              </tr>
            </thead>

            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4}>Mengambil data...</td>
                </tr>
              ) : filteredData.length === 0 ? (
                <tr>
                  <td colSpan={4}>Tidak ada IP yang sesuai dengan filter.</td>
                </tr>
              ) : (
                filteredData.map((item) => (
                  <tr key={item.ip}>
                    <td>
                      <code className="ip-address">{item.ip}</code>
                    </td>

                    <td>
                      <span
                        className={`status ${
                          item.status === "ONLINE"
                            ? "online"
                            : item.status === "OFFLINE"
                              ? "offline"
                              : ""
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>

                    <td>{item.customer}</td>

                    <td>
                      {item.profile === "-" ? (
                        "-"
                      ) : (
                        <span className="badge">{item.profile}</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
