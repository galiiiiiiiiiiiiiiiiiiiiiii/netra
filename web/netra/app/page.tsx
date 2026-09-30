"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* =========================================================
   TYPES
========================================================= */

type Customer = {
  name?: string;
  status?: string;
  profile?: string;
  ip?: string;
  uptime?: string;
};

type RouterInfo = {
  name?: string;
  version?: string;
  uptime?: string;
  cpuLoad?: string;
  freeMemory?: string;
  totalMemory?: string;
};

type TrafficInterface = {
  name: string;
  sourceName?: string;
  status: "online" | "offline";
  downloadBps: number;
  uploadBps: number;
  rxBytes: number;
  txBytes: number;
  rxPackets: number;
  txPackets: number;
};

type TrafficPoint = {
  timestamp: number;
  time: string;
  download: number;
  upload: number;
};

/* =========================================================
   CONSTANTS
========================================================= */

/*
 * Label sumbu grafik ditampilkan setiap 5 menit.
 */
const TRAFFIC_SAMPLE_INTERVAL = 5 * 60 * 1_000;
const TRAFFIC_MAX_POINTS = 25;
const TRAFFIC_TICK_INTERVAL = 1;
const TRAFFIC_HISTORY_STORAGE_KEY = "netra:traffic-history";

/* =========================================================
   HELPERS
========================================================= */
function toNumber(value: unknown): number {
  const number = Number(value ?? 0);

  return Number.isFinite(number) ? number : 0;
}

function formatSpeed(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) {
    return "0 bps";
  }

  if (bps >= 1_000_000_000) {
    return `${(bps / 1_000_000_000).toFixed(2)} Gbps`;
  }

  if (bps >= 1_000_000) {
    return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  }

  if (bps >= 1_000) {
    return `${(bps / 1_000).toFixed(2)} Kbps`;
  }

  return `${Math.round(bps)} bps`;
}

function formatMemory(value?: string): string {
  if (!value) {
    return "-";
  }

  const mb = Number(value) / 1024 / 1024;

  if (!Number.isFinite(mb)) {
    return "-";
  }

  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  return `${Math.round(mb)} MB`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/* =========================================================
   LOGIN AND DASHBOARD
========================================================= */

export default function HomePage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setAuthenticated(data.authenticated === true))
      .catch(() => setAuthenticated(false));
  }, []);

  if (authenticated === null) {
    return <div className="auth-loading">Memeriksa sesi...</div>;
  }

  if (!authenticated) {
    return <LoginForm />;
  }

  return <Dashboard />;
}

function LoginForm() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        throw new Error(data.error || "Login gagal");
      }

      window.location.assign("/");
    } catch (loginError) {
      setError(
        loginError instanceof Error ? loginError.message : "Login gagal",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-panel">
        <div className="auth-brand">
          <div className="brand-logo">N</div>
          <div>
            <div className="brand-name">NETRA</div>
            <div className="brand-subtitle">Network Analyzer</div>
          </div>
        </div>

        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Masuk ke dashboard jaringan Netra</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Dashboard() {
  const [connected, setConnected] = useState<boolean | null>(null);

  const [router, setRouter] = useState<RouterInfo>({});

  const [customers, setCustomers] = useState<Customer[]>([]);

  const [summary, setSummary] = useState({
    total: 0,
    online: 0,
    offline: 0,
    disabled: 0,
  });

  const [interfaces, setInterfaces] = useState<TrafficInterface[]>([]);

  const [trafficHistory, setTrafficHistory] = useState<TrafficPoint[]>([]);

  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  /*
   * Counter MikroTik sebelumnya.
   *
   * rx-byte / tx-byte adalah counter total.
   * Kita pakai selisih counter untuk mendapatkan bps.
   */
  const previousCounters = useRef<
    Map<
      string,
      {
        rxBytes: number;
        txBytes: number;
        timestamp: number;
      }
    >
  >(new Map());

  /*
   * Nilai traffic terakhir yang valid.
   *
   * Ini penting supaya grafik TIDAK jatuh ke 0
   * ketika polling gagal / data sementara tidak tersedia.
   */
  const lastTraffic = useRef({
    download: 0,
    upload: 0,
  });

  /*
   * Mencegah request traffic overlap.
   */
  const trafficLoadingRef = useRef(false);

  const trafficTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mountedRef = useRef(true);

  /* =======================================================
     LOAD DASHBOARD
  ======================================================= */

  const loadDashboard = useCallback(async () => {
    setRefreshing(true);

    try {
      /*
       * ROUTER
       */
      const testResponse = await fetch("/api/mikrotik/test", {
        cache: "no-store",
      });

      const test = await testResponse.json();

      if (test.success === true && test.connected === true) {
        setConnected(true);

        setRouter({
          name: test.router?.identity?.[0]?.name,
          version: test.router?.version,
          uptime: test.router?.uptime,
          cpuLoad: test.router?.cpuLoad,
          freeMemory: test.router?.freeMemory,
          totalMemory: test.router?.totalMemory,
        });
      } else {
        setConnected(false);
      }

      /*
       * PPP
       */
      const pppResponse = await fetch("/api/mikrotik/ppp/status", {
        cache: "no-store",
      });

      const ppp = await pppResponse.json();

      if (ppp.success === true) {
        setCustomers(Array.isArray(ppp.users) ? ppp.users : []);

        setSummary({
          total: Number(ppp.summary?.total ?? 0),

          online: Number(ppp.summary?.online ?? 0),

          offline: Number(ppp.summary?.offline ?? 0),

          disabled: Number(ppp.summary?.disabled ?? 0),
        });
      }
    } catch (error) {
      console.error("Dashboard error:", error);

      setConnected(false);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  /* =======================================================
     LOAD TRAFFIC
  ======================================================= */

  const loadTraffic = useCallback(async () => {
    /*
     * Jangan overlap request.
     */
    if (trafficLoadingRef.current) {
      return;
    }

    trafficLoadingRef.current = true;

    try {
      const response = await fetch("/api/mikrotik/traffic", {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data.success || !Array.isArray(data.interfaces)) {
        throw new Error(data.error || "Data traffic tidak valid");
      }

      const now = Date.now();

      const result: TrafficInterface[] = data.interfaces.map((item: any) => {
        const key = item[".id"] || item.name;

        const rxBytes = toNumber(item["rx-byte"]);

        const txBytes = toNumber(item["tx-byte"]);

        const rxPackets = toNumber(item["rx-packet"]);

        const txPackets = toNumber(item["tx-packet"]);

        const previous = previousCounters.current.get(key);

        /*
         * Default pakai traffic sebelumnya,
         * BUKAN 0.
         */
        let downloadBps = lastTraffic.current.download;

        let uploadBps = lastTraffic.current.upload;

        /*
         * Kalau sudah punya counter sebelumnya,
         * hitung delta.
         */
        if (previous) {
          const elapsedSeconds = (now - previous.timestamp) / 1000;

          if (elapsedSeconds > 0) {
            const rxDelta = Math.max(0, rxBytes - previous.rxBytes);

            const txDelta = Math.max(0, txBytes - previous.txBytes);

            downloadBps = (rxDelta * 8) / elapsedSeconds;

            uploadBps = (txDelta * 8) / elapsedSeconds;
          }
        }

        const monitoredDownload = Number(item["rx-bits-per-second"]);
        const monitoredUpload = Number(item["tx-bits-per-second"]);

        if (Number.isFinite(monitoredDownload)) {
          downloadBps = monitoredDownload;
        }

        if (Number.isFinite(monitoredUpload)) {
          uploadBps = monitoredUpload;
        }

        /*
         * Simpan counter terbaru.
         */
        previousCounters.current.set(key, {
          rxBytes,
          txBytes,
          timestamp: now,
        });

        return {
          name: item.comment || item.name || item[".id"] || "-",
          sourceName: item.name,

          status:
            item.running === "true" && item.disabled !== "true"
              ? "online"
              : "offline",

          downloadBps,
          uploadBps,

          rxBytes,
          txBytes,

          rxPackets,
          txPackets,
        };
      });

      /*
       * Hapus counter interface yang sudah tidak ada.
       */
      const currentKeys = new Set(
        data.interfaces.map((item: any) => item[".id"] || item.name),
      );

      for (const key of previousCounters.current.keys()) {
        if (!currentKeys.has(key)) {
          previousCounters.current.delete(key);
        }
      }

      /*
       * Gunakan interface dengan throughput terbesar.
       * Menjumlahkan semua interface bisa menghitung bridge,
       * ether, dan VLAN yang membawa traffic sama lebih dari sekali.
       */
      const primaryInterface =
        result.find((item) => item.sourceName === "ether1") ??
        result.reduce(
          (maximum, item) =>
            item.downloadBps + item.uploadBps >
            maximum.downloadBps + maximum.uploadBps
              ? item
              : maximum,
          result[0] ?? {
            name: "-",
            status: "offline" as const,
            downloadBps: 0,
            uploadBps: 0,
            rxBytes: 0,
            txBytes: 0,
            rxPackets: 0,
            txPackets: 0,
          },
        );

      const totalDownload = primaryInterface.downloadBps;
      const totalUpload = primaryInterface.uploadBps;

      /*
       * Hanya update nilai terakhir
       * kalau hasilnya valid.
       */
      if (Number.isFinite(totalDownload)) {
        lastTraffic.current.download = totalDownload;
      }

      if (Number.isFinite(totalUpload)) {
        lastTraffic.current.upload = totalUpload;
      }

      if (mountedRef.current) {
        setInterfaces(result);
      }
    } catch (error) {
      /*
       * JANGAN reset traffic menjadi 0.
       *
       * Kalau API gagal sekali,
       * grafik tetap menggunakan nilai
       * terakhir yang valid.
       */
      console.error("Traffic error:", error);
    } finally {
      trafficLoadingRef.current = false;

      /*
       * Polling berikutnya setelah request
       * selesai.
       */
      if (mountedRef.current) {
        trafficTimerRef.current = setTimeout(() => {
          loadTraffic();
        }, 1_000);
      }
    }
  }, []);

  /* =======================================================
     INITIAL DASHBOARD
  ======================================================= */

  useEffect(() => {
    loadDashboard();

    const timer = setInterval(() => {
      loadDashboard();
    }, 15_000);

    return () => {
      clearInterval(timer);
    };
  }, [loadDashboard]);

  /* =======================================================
     INITIAL TRAFFIC
  ======================================================= */

  useEffect(() => {
    mountedRef.current = true;

    loadTraffic();

    return () => {
      mountedRef.current = false;

      if (trafficTimerRef.current) {
        clearTimeout(trafficTimerRef.current);

        trafficTimerRef.current = null;
      }
    };
  }, [loadTraffic]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(TRAFFIC_HISTORY_STORAGE_KEY);
      if (!stored) return;

      const history = JSON.parse(stored) as TrafficPoint[];
      if (!Array.isArray(history)) return;

      setTrafficHistory(history.slice(-TRAFFIC_MAX_POINTS));
    } catch {
      localStorage.removeItem(TRAFFIC_HISTORY_STORAGE_KEY);
    }
  }, []);

  /* =======================================================
     TRAFFIC HISTORY
  ======================================================= */

  useEffect(() => {
    /*
     * Jangan mengambil history setiap 1 detik.
     *
     * Traffic API boleh polling cepat untuk mendapatkan
     * nilai terbaru, tetapi grafik hanya mengambil
     * SAMPLE setiap 5 menit.
     *
     * 25 sample dengan jarak 5 menit mencakup 2 jam.
     */
    const addTrafficSample = () => {
      if (!mountedRef.current) {
        return;
      }

      const point: TrafficPoint = {
        timestamp: Date.now(),
        time: formatTime(new Date()),

        download: lastTraffic.current.download,

        upload: lastTraffic.current.upload,
      };

      setTrafficHistory((previous) => {
        const next = [...previous, point];
        const history = next.slice(-TRAFFIC_MAX_POINTS);

        localStorage.setItem(
          TRAFFIC_HISTORY_STORAGE_KEY,
          JSON.stringify(history),
        );

        /*
         * Hanya simpan 25 titik.
         *
         * 25 titik dengan jarak 5 menit mencakup 2 jam.
         */
        return history;
      });
    };

    /*
     * Sample pertama.
     */
    addTrafficSample();

    /*
     * Sample berikutnya setiap 5 menit.
     */
    const timer = setInterval(addTrafficSample, TRAFFIC_SAMPLE_INTERVAL);

    return () => {
      clearInterval(timer);
    };
  }, []);

  /* =======================================================
     CALCULATIONS
  ======================================================= */

  const totalDownload = lastTraffic.current.download;

  const totalUpload = lastTraffic.current.upload;

  const activeInterfaces = interfaces.filter(
    (item) => item.status === "online",
  ).length;

  const totalRxPackets = interfaces.reduce(
    (total, item) => total + item.rxPackets,
    0,
  );

  const totalTxPackets = interfaces.reduce(
    (total, item) => total + item.txPackets,
    0,
  );

  const routerStatus =
    connected === true
      ? "Connected"
      : connected === false
        ? "Disconnected"
        : "Checking...";

  const cpuValue = Number(router.cpuLoad ?? 0);

  const totalMemory = formatMemory(router.totalMemory);

  const freeMemory = formatMemory(router.freeMemory);

  const memoryUsedPercent =
    router.totalMemory && router.freeMemory
      ? Math.max(
          0,
          Math.min(
            100,
            100 -
              (Number(router.freeMemory) / Number(router.totalMemory)) * 100,
          ),
        )
      : 0;

  /* =======================================================
     GRAPH
  ======================================================= */

  const graphMax = Math.max(
    10,
    ...trafficHistory.map((point) => Math.max(point.download, point.upload)),
  );

  /*
   * Tambahkan sedikit ruang di atas grafik.
   */
  const graphScale = graphMax * 1.15;

  const graphWidth = 1000;
  const graphHeight = 300;
  const graphViewHeight = graphHeight + 28;
  const trafficEndDate = new Date();
  trafficEndDate.setSeconds(0, 0);
  trafficEndDate.setMinutes(Math.floor(trafficEndDate.getMinutes() / 5) * 5);
  const trafficEndTimestamp = trafficEndDate.getTime();
  const trafficStartTimestamp =
    trafficEndTimestamp - (TRAFFIC_MAX_POINTS - 1) * TRAFFIC_SAMPLE_INTERVAL;
  const trafficTimeTicks = Array.from(
    {
      length: Math.floor((TRAFFIC_MAX_POINTS - 1) / TRAFFIC_TICK_INTERVAL) + 1,
    },
    (_, index) => {
      const timestamp =
        trafficStartTimestamp +
        index * TRAFFIC_TICK_INTERVAL * TRAFFIC_SAMPLE_INTERVAL;

      return {
        timestamp,
        label: formatTime(new Date(timestamp)),
      };
    },
  );

  const getXForTimestamp = (timestamp: number) => {
    const elapsed = trafficEndTimestamp - trafficStartTimestamp;

    if (elapsed <= 0) {
      return 0;
    }

    return Math.max(
      0,
      Math.min(
        graphWidth,
        ((timestamp - trafficStartTimestamp) / elapsed) * graphWidth,
      ),
    );
  };

  const getX = (index: number) => {
    return getXForTimestamp(
      trafficHistory[index]?.timestamp ?? trafficStartTimestamp,
    );
  };

  const getY = (value: number) => {
    return graphHeight - (value / graphScale) * graphHeight;
  };

  const downloadPoints = trafficHistory
    .map((point, index) => `${getX(index)},${getY(point.download)}`)
    .join(" ");

  const uploadPoints = trafficHistory
    .map((point, index) => `${getX(index)},${getY(point.upload)}`)
    .join(" ");

  const downloadArea =
    trafficHistory.length > 0
      ? `0,${graphHeight} ${downloadPoints} ${graphWidth},${graphHeight}`
      : "";

  const uploadArea =
    trafficHistory.length > 0
      ? `0,${graphHeight} ${uploadPoints} ${graphWidth},${graphHeight}`
      : "";

  /* =======================================================
     RETURN
  ======================================================= */

  return (
    <>
      <style jsx global>{`
        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #0b0e13;
          color: #e8ecf3;
          font-family: Arial, Helvetica, sans-serif;
        }

        button {
          font-family: inherit;
        }

        .dashboard {
          width: 100%;
          min-height: 100vh;
          background: #0b0e13;
        }

        /* =================================================
           HEADER
        ================================================= */

        .topbar {
          height: 84px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0 36px;
          border-bottom: 1px solid #252a33;
          background: #0b0e13;
        }

        .page-title {
          margin: 0;
          font-size: 26px;
          line-height: 1;
          font-weight: 600;
          color: #f1f4f8;
        }

        .page-subtitle {
          margin-top: 8px;
          color: #697386;
          font-size: 12px;
        }

        .topbar-right {
          display: flex;
          align-items: center;
          gap: 18px;
        }

        .connection-status {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 11px;
        }

        .connection-status.connected {
          color: #45dc8b;
        }

        .connection-status.disconnected {
          color: #ff6370;
        }

        .connection-status.checking {
          color: #e7bd55;
        }

        .status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
        }

        .green {
          background: #35d07f;
        }

        .red {
          background: #ff5c6c;
        }

        .yellow {
          background: #e8bd4f;
        }

        .refresh-button {
          border: 1px solid #303641;
          background: #181c24;
          color: #d8dce4;
          padding: 9px 14px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        }

        .refresh-button:hover {
          background: #20252e;
        }

        .refresh-button:disabled {
          opacity: 0.5;
          cursor: default;
        }

        /* =================================================
           CONTENT
        ================================================= */

        .content {
          padding: 26px 36px 50px;
        }

        /* =================================================
           ROUTER INFO
        ================================================= */

        .router-info {
          display: grid;
          grid-template-columns:
            1.5fr
            1fr
            0.8fr
            1fr
            1fr;

          border: 1px solid #282e38;
          background: #12151b;
          border-radius: 8px;
          margin-bottom: 18px;
          overflow: hidden;
        }

        .info-item {
          padding: 15px 18px;
          border-right: 1px solid #282e38;
        }

        .info-item:last-child {
          border-right: none;
        }

        .info-label {
          color: #687286;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.7px;
        }

        .info-value {
          margin-top: 6px;
          color: #e7eaf0;
          font-size: 13px;
        }

        /* =================================================
           SUMMARY
        ================================================= */

        .summary-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 14px;
          margin-bottom: 18px;
        }

        .summary-card {
          min-height: 118px;
          padding: 20px;
          border: 1px solid #282e38;
          background: #12151b;
          border-radius: 7px;
        }

        .summary-title {
          color: #788296;
          font-size: 10px;
          letter-spacing: 1.3px;
          font-weight: 500;
        }

        .summary-number {
          margin-top: 15px;
          font-size: 30px;
          line-height: 1;
          font-weight: 500;
          color: #f1f4f8;
        }

        .summary-description {
          margin-top: 9px;
          color: #596477;
          font-size: 10px;
        }

        /* =================================================
           TRAFFIC GRAPH
        ================================================= */

        .traffic-card {
          width: 100%;
          border: 1px solid #282e38;
          background: #12151b;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 0;
        }

        .traffic-card-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px 20px;
          border-bottom: 1px solid #282e38;
        }

        .traffic-title {
          margin: 0;
          font-size: 15px;
          font-weight: 500;
          color: #e9edf3;
        }

        .traffic-subtitle {
          margin: 5px 0 0;
          color: #697386;
          font-size: 10px;
        }

        .traffic-current {
          display: flex;
          align-items: center;
          gap: 20px;
          font-size: 12px;
          white-space: nowrap;
        }

        .download-text {
          color: #3d91ff;
        }

        .upload-text {
          color: #35d07f;
        }

        .graph-container {
          height: 298px;
          padding: 20px 20px 5px;
          position: relative;
        }

        .traffic-svg {
          width: 100%;
          height: 100%;
          display: block;
          overflow: visible;
        }

        .graph-grid {
          stroke: #202631;
          stroke-width: 1;
        }

        .graph-axis-text {
          fill: #687286;
          font-size: 11px;
        }

        .graph-time-text {
          fill: #687286;
          font-size: 11px;
          text-anchor: middle;
          dominant-baseline: middle;
        }

        .download-line {
          fill: none;
          stroke: #3b91ff;
          stroke-width: 3;
          stroke-linejoin: round;
          stroke-linecap: round;
        }

        .upload-line {
          fill: none;
          stroke: #35d07f;
          stroke-width: 3;
          stroke-linejoin: round;
          stroke-linecap: round;
        }

        .download-area {
          fill: #3b91ff;
          opacity: 0.1;
        }

        .upload-area {
          fill: #35d07f;
          opacity: 0.07;
        }

        .graph-point-download {
          fill: #3b91ff;
        }

        .graph-point-upload {
          fill: #35d07f;
        }

        .graph-footer {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 10px 20px 14px;
          color: #596477;
          font-size: 10px;
        }

        .legend {
          display: flex;
          align-items: center;
          gap: 18px;
        }

        .legend-item {
          display: flex;
          align-items: center;
          gap: 7px;
        }

        .legend-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
        }

        .legend-download {
          background: #3b91ff;
        }

        .legend-upload {
          background: #35d07f;
        }

        /* =================================================
           LOWER GRID
        ================================================= */

        .dashboard-grid {
          display: grid;
          grid-template-columns:
            minmax(0, 1.6fr)
            minmax(320px, 1fr);
          gap: 18px;
        }

        .traffic-layout {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 18px;
          align-items: stretch;
          margin-bottom: 18px;
        }

        .traffic-layout > .traffic-card,
        .traffic-layout > .panel {
          width: 100%;
          height: 100%;
          margin: 0;
        }

        .panel {
          overflow: hidden;
          border: 1px solid #282e38;
          background: #12151b;
          border-radius: 8px;
        }

        .panel-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 18px;
          border-bottom: 1px solid #282e38;
        }

        .panel-title {
          font-size: 14px;
          font-weight: 500;
          color: #e9edf3;
        }

        .panel-subtitle {
          margin-top: 5px;
          color: #697386;
          font-size: 10px;
        }

        .panel-link {
          border: 0;
          background: transparent;
          color: #6caeff;
          font-size: 10px;
          cursor: pointer;
        }

        .table-wrap {
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
        }

        th {
          padding: 12px 18px;
          text-align: left;
          color: #687286;
          font-size: 9px;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          font-weight: 500;
          background: #101319;
        }

        td {
          padding: 13px 18px;
          border-top: 1px solid #222731;
          color: #9da6b6;
          font-size: 11px;
        }

        tbody tr:hover {
          background: #151920;
        }

        .interface-name {
          color: #e5e8ed;
          font-weight: 500;
        }

        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 9px;
          border-radius: 20px;
          font-size: 9px;
        }

        .status-badge.online {
          background: #0d2b20;
          color: #3bdb88;
        }

        .status-badge.offline {
          background: #2b171b;
          color: #ff6875;
        }

        .badge-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
        }

        .profile-badge {
          display: inline-block;
          border: 1px solid #303642;
          background: #191d25;
          border-radius: 4px;
          padding: 4px 7px;
          color: #aeb6c4;
          font-size: 9px;
        }

        /* =================================================
           SYSTEM INFO
        ================================================= */

        .system-info {
          padding: 5px 18px 15px;
        }

        .system-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          padding: 13px 0;
          border-bottom: 1px solid #222731;
        }

        .system-row:last-child {
          border-bottom: none;
        }

        .system-label {
          color: #697386;
          font-size: 10px;
        }

        .system-value {
          color: #e5e8ed;
          font-size: 11px;
          text-align: right;
        }

        .progress-wrap {
          margin-top: 12px;
          height: 5px;
          width: 100%;
          background: #222a35;
          border-radius: 99px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          border-radius: 99px;
          background: #3b91ff;
        }

        .loading {
          padding: 35px;
          text-align: center;
          color: #687286;
          font-size: 11px;
        }

        /* =================================================
           RESPONSIVE
        ================================================= */

        @media (max-width: 1200px) {
          .summary-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .router-info {
            grid-template-columns: repeat(3, 1fr);
          }

          .info-item:nth-child(3) {
            border-right: none;
          }

          .dashboard-grid {
            grid-template-columns: 1fr;
          }

          .traffic-card {
            width: 100%;
          }

          .traffic-layout {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 800px) {
          .topbar {
            height: auto;
            padding: 20px;
            gap: 15px;
            align-items: flex-start;
          }

          .topbar-right {
            flex-direction: column;
            align-items: flex-end;
          }

          .content {
            padding: 20px;
          }

          .router-info {
            grid-template-columns: 1fr;
          }

          .info-item {
            border-right: none;
            border-bottom: 1px solid #282e38;
          }

          .info-item:last-child {
            border-bottom: none;
          }

          .summary-grid {
            grid-template-columns: 1fr;
          }

          .traffic-card-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 12px;
          }

          .traffic-current {
            gap: 14px;
          }
        }
      `}</style>

      <main className="dashboard">
        {/* =================================================
            TOP HEADER
        ================================================= */}

        <header className="topbar">
          <div>
            <h1 className="page-title">Dashboard</h1>

            <div className="page-subtitle">
              Network Traffic & Resource Analyzer
            </div>
          </div>

          <div className="topbar-right">
            <div
              className={`connection-status ${
                connected === true
                  ? "connected"
                  : connected === false
                    ? "disconnected"
                    : "checking"
              }`}
            >
              <span
                className={`status-dot ${
                  connected === true
                    ? "green"
                    : connected === false
                      ? "red"
                      : "yellow"
                }`}
              />

              {routerStatus}
            </div>

            <button
              className="refresh-button"
              onClick={() => {
                setRefreshing(true);

                loadDashboard();

                /*
                 * Reset counter traffic supaya
                 * manual refresh tidak menghasilkan
                 * delta palsu.
                 */
                previousCounters.current.clear();

                loadTraffic();
              }}
              disabled={refreshing}
            >
              ↻ {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </header>

        <div className="content">
          {/* =================================================
              ROUTER INFO
          ================================================= */}

          <div className="router-info">
            <InfoItem label="Current Router" value={router.name || "-"} />

            <InfoItem label="RouterOS" value={router.version || "-"} />

            <InfoItem
              label="CPU Load"
              value={router.cpuLoad ? `${router.cpuLoad}%` : "-"}
            />

            <InfoItem label="Memory Free" value={freeMemory} />

            <InfoItem label="Uptime" value={router.uptime || "-"} />
          </div>

          {/* =================================================
              SUMMARY CARDS
          ================================================= */}

          <div className="summary-grid">
            <SummaryCard
              title="PPP ONLINE"
              value={summary.online}
              description="users currently connected"
            />

            <SummaryCard
              title="TOTAL CUSTOMERS"
              value={summary.total}
              description="registered PPP accounts"
            />

            <SummaryCard
              title="OFFLINE"
              value={summary.offline}
              description="customers disconnected"
            />

            <SummaryCard
              title="DISABLED"
              value={summary.disabled}
              description="disabled accounts"
            />
          </div>

          {/* =================================================
              TRAFFIC GRAPH
          ================================================= */}

          <div className="traffic-layout">
            <section className="traffic-card">
              <div className="traffic-card-header">
                <div>
                  <h2 className="traffic-title">Interface Traffic</h2>

                  <p className="traffic-subtitle">
                    Real-time RX dan TX traffic — history 2 jam
                  </p>
                </div>

                <div className="traffic-current">
                  <span className="download-text">
                    ↓ {formatSpeed(totalDownload)}
                  </span>

                  <span className="upload-text">
                    ↑ {formatSpeed(totalUpload)}
                  </span>
                </div>
              </div>

              <div className="graph-container">
                {trafficHistory.length === 0 ? (
                  <div className="loading">Mengambil data traffic...</div>
                ) : (
                  <svg
                    className="traffic-svg"
                    viewBox={`0 0 ${graphWidth} ${graphViewHeight}`}
                    preserveAspectRatio="none"
                  >
                    {/* ================================
                      GRID
                  ================================= */}

                    {[0, 25, 50, 75, 100].map((percent) => {
                      const y = graphHeight - (percent / 100) * graphHeight;

                      const value = (graphScale * percent) / 100;

                      return (
                        <g key={percent}>
                          <line
                            x1="0"
                            y1={y}
                            x2={graphWidth}
                            y2={y}
                            className="graph-grid"
                          />

                          <text
                            x="0"
                            y={Math.max(12, y - 6)}
                            className="graph-axis-text"
                          >
                            {formatSpeed(value)}
                          </text>
                        </g>
                      );
                    })}

                    {/* ================================
                      AREAS
                  ================================= */}

                    <polygon points={downloadArea} className="download-area" />

                    <polygon points={uploadArea} className="upload-area" />

                    {/* ================================
                      LINES
                  ================================= */}

                    <polyline
                      points={downloadPoints}
                      className="download-line"
                    />

                    <polyline points={uploadPoints} className="upload-line" />

                    {/* ================================
                      TIME AXIS
                  ================================= */}

                    {trafficTimeTicks.map(({ timestamp, label }) => {
                      const axisX = Math.max(
                        18,
                        Math.min(graphWidth - 18, getXForTimestamp(timestamp)),
                      );

                      return (
                        <text
                          key={timestamp}
                          x={axisX}
                          y={graphHeight + 18}
                          transform={`rotate(-90 ${axisX} ${graphHeight + 18})`}
                          className="graph-time-text"
                        >
                          {label}
                        </text>
                      );
                    })}

                    {/* ================================
                      LAST POINT
                  ================================= */}

                    {trafficHistory.length > 0 && (
                      <>
                        <circle
                          cx={getX(trafficHistory.length - 1)}
                          cy={getY(
                            trafficHistory[trafficHistory.length - 1].download,
                          )}
                          r="4"
                          className="graph-point-download"
                        />

                        <circle
                          cx={getX(trafficHistory.length - 1)}
                          cy={getY(
                            trafficHistory[trafficHistory.length - 1].upload,
                          )}
                          r="4"
                          className="graph-point-upload"
                        />
                      </>
                    )}
                  </svg>
                )}
              </div>

              <div className="graph-footer">
                <div className="legend">
                  <div className="legend-item">
                    <span className="legend-dot legend-download" />
                    Download
                  </div>

                  <div className="legend-item">
                    <span className="legend-dot legend-upload" />
                    Upload
                  </div>
                </div>

                <span>2 hours</span>
              </div>
            </section>

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Traffic Summary</div>

                  <div className="panel-subtitle">
                    Current network statistics
                  </div>
                </div>
              </div>

              <div className="system-info">
                <div className="system-row">
                  <span className="system-label">Download</span>
                  <span className="system-value">
                    {formatSpeed(totalDownload)}
                  </span>
                </div>

                <div className="system-row">
                  <span className="system-label">Upload</span>
                  <span className="system-value">
                    {formatSpeed(totalUpload)}
                  </span>
                </div>

                <div className="system-row">
                  <span className="system-label">RX Packets</span>
                  <span className="system-value">
                    {totalRxPackets.toLocaleString("id-ID")}
                  </span>
                </div>

                <div className="system-row">
                  <span className="system-label">TX Packets</span>
                  <span className="system-value">
                    {totalTxPackets.toLocaleString("id-ID")}
                  </span>
                </div>

                <div className="system-row">
                  <span className="system-label">Interface</span>
                  <span className="system-value">{interfaces.length}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Active Interface</span>
                  <span className="system-value">{activeInterfaces}</span>
                </div>
              </div>
            </section>
          </div>

          {/* =================================================
              LOWER DASHBOARD
          ================================================= */}

          <div className="dashboard-grid">
            {/* =============================================
                INTERFACE OVERVIEW
            ============================================= */}

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">Interface Overview</div>

                  <div className="panel-subtitle">
                    Current RX dan TX traffic interface
                  </div>
                </div>

                <button className="panel-link">View All →</button>
              </div>

              <div className="table-wrap">
                {interfaces.length === 0 ? (
                  <div className="loading">Mengambil data interface...</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Name</th>
                        <th>Status</th>
                        <th>RX</th>
                        <th>TX</th>
                      </tr>
                    </thead>

                    <tbody>
                      {interfaces.slice(0, 10).map((item, index) => {
                        const online = item.status === "online";

                        return (
                          <tr key={item.name}>
                            <td>{index + 1}</td>

                            <td className="interface-name">{item.name}</td>

                            <td>
                              <span
                                className={`status-badge ${
                                  online ? "online" : "offline"
                                }`}
                              >
                                <span
                                  className={`badge-dot ${
                                    online ? "green" : "red"
                                  }`}
                                />

                                {online ? "Up" : "Down"}
                              </span>
                            </td>

                            <td>{formatSpeed(item.downloadBps)}</td>

                            <td>{formatSpeed(item.uploadBps)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </section>

            {/* =============================================
                SYSTEM INFORMATION
            ============================================= */}

            <section className="panel">
              <div className="panel-header">
                <div>
                  <div className="panel-title">System Information</div>

                  <div className="panel-subtitle">
                    Current MikroTik router status
                  </div>
                </div>
              </div>

              <div className="system-info">
                <div className="system-row">
                  <span className="system-label">Identity</span>

                  <span className="system-value">{router.name || "-"}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">RouterOS Version</span>

                  <span className="system-value">{router.version || "-"}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Uptime</span>

                  <span className="system-value">{router.uptime || "-"}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">CPU Load</span>

                  <span className="system-value">{router.cpuLoad || "0%"}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Memory Usage</span>

                  <span className="system-value">
                    {memoryUsedPercent.toFixed(1)}%
                  </span>
                </div>

                <div className="progress-wrap">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${memoryUsedPercent}%`,
                    }}
                  />
                </div>

                <div className="system-row">
                  <span className="system-label">Free Memory</span>

                  <span className="system-value">{freeMemory}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Total Memory</span>

                  <span className="system-value">{totalMemory}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Interfaces</span>

                  <span className="system-value">{interfaces.length}</span>
                </div>

                <div className="system-row">
                  <span className="system-label">Active Interfaces</span>

                  <span className="system-value">{activeInterfaces}</span>
                </div>
              </div>
            </section>
          </div>

          {/* =================================================
              PPP USERS
          ================================================= */}

          <section
            className="panel"
            style={{
              marginTop: "18px",
            }}
          >
            <div className="panel-header">
              <div>
                <div className="panel-title">PPP Customer Status</div>

                <div className="panel-subtitle">
                  Live customer connection data
                </div>
              </div>

              <div className="live">
                <span className="live-dot" />
                LIVE
              </div>
            </div>

            <div className="table-wrap">
              {loading ? (
                <div className="loading">Loading MikroTik data...</div>
              ) : customers.length === 0 ? (
                <div className="loading">No PPP customer data</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Customer</th>
                      <th>Status</th>
                      <th>IP Address</th>
                      <th>Profile</th>
                      <th>Uptime</th>
                    </tr>
                  </thead>

                  <tbody>
                    {customers.slice(0, 10).map((customer, index) => {
                      const online =
                        customer.status?.toLowerCase() === "online";

                      return (
                        <tr key={`${customer.name}-${index}`}>
                          <td className="interface-name">
                            {customer.name || "-"}
                          </td>

                          <td>
                            <span
                              className={`status-badge ${
                                online ? "online" : "offline"
                              }`}
                            >
                              <span
                                className={`badge-dot ${
                                  online ? "green" : "red"
                                }`}
                              />

                              {online ? "Online" : "Offline"}
                            </span>
                          </td>

                          <td>{customer.ip || "-"}</td>

                          <td>
                            <span className="profile-badge">
                              {customer.profile || "-"}
                            </span>
                          </td>

                          <td>{customer.uptime || "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}

/* =========================================================
   COMPONENTS
========================================================= */

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-item">
      <div className="info-label">{label}</div>

      <div className="info-value">{value}</div>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  description,
}: {
  title: string;
  value: number;
  description: string;
}) {
  return (
    <div className="summary-card">
      <div className="summary-title">{title}</div>

      <div className="summary-number">{value}</div>

      <div className="summary-description">{description}</div>
    </div>
  );
}
