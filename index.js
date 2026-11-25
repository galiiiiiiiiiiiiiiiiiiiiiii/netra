require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const { mkdir, readFile, writeFile } = require("fs/promises");
const path = require("path");

const NETRA_BASE_URL = (
  process.env.NETRA_BASE_URL || "http://localhost:3000"
).replace(/\/$/, "");
const NETRA_ALERT_URL = `${NETRA_BASE_URL}/api/alerts/bot`;
const NETRA_LOG_URL = `${NETRA_BASE_URL}/api/alerts/logs/bot`;
const NETRA_PPP_URL = `${NETRA_BASE_URL}/api/ppp-secrets/bot`;
const NETRA_INTERFACES_URL = `${NETRA_BASE_URL}/api/mikrotik/interfaces/bot`;
const NETRA_DASHBOARD_URL = `${NETRA_BASE_URL}/api/mikrotik/dashboard`;
const ROUTER_API_KEY = process.env.ROUTER_API_KEY;
const ROUTER_URL = (
  process.env.ROUTER_BASE_URL || "http://localhost:20128/v1"
).replace(/\/$/, "");
const MODEL = process.env.MODEL || "netra";
const alertChannelId = process.env.DISCORD_ALERT_CHANNEL_ID;
const seenAlertIds = new Set();
const conversations = new Map();
let alertsInitialized = false;
let missingConfigLogged = false;
let lastNetraLogs = [];
const cacheFile = path.join(__dirname, "data", "discord-netra-cache.json");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

function trimSet(set, limit = 200) {
  while (set.size > limit) {
    set.delete(set.values().next().value);
  }
}

async function loadNetraCache() {
  try {
    const data = JSON.parse(await readFile(cacheFile, "utf8"));
    lastNetraLogs = Array.isArray(data.logs) ? data.logs : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("NETRA CACHE READ ERROR:", error.message);
    }
  }
}

async function saveNetraCache(logs) {
  try {
    await mkdir(path.dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, `${JSON.stringify({ logs }, null, 2)}\n`);
  } catch (error) {
    console.error("NETRA CACHE WRITE ERROR:", error.message);
  }
}

async function fetchNetraAlerts() {
  const response = await fetch(NETRA_ALERT_URL, {
    headers: {
      "x-netra-internal-secret": process.env.NETRA_INTERNAL_SECRET || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Netra API gagal (${response.status})`);
  }

  return response.json();
}

async function fetchNetraLogs() {
  const response = await fetch(NETRA_LOG_URL, {
    headers: {
      "x-netra-internal-secret": process.env.NETRA_INTERNAL_SECRET || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Netra logs API gagal (${response.status})`);
  }

  const data = await response.json();
  lastNetraLogs = Array.isArray(data.logs) ? data.logs : [];
  await saveNetraCache(lastNetraLogs);
  return lastNetraLogs;
}

async function fetchNetraPPPSecrets() {
  const response = await fetch(NETRA_PPP_URL, {
    headers: {
      "x-netra-internal-secret": process.env.NETRA_INTERNAL_SECRET || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Netra PPP API gagal (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data.users) ? data.users : [];
}

async function fetchNetraInterfaces() {
  const response = await fetch(NETRA_INTERFACES_URL, {
    headers: {
      "x-netra-internal-secret": process.env.NETRA_INTERNAL_SECRET || "",
    },
  });

  if (!response.ok) {
    throw new Error(`Netra interfaces API gagal (${response.status})`);
  }

  const data = await response.json();
  return Array.isArray(data.interfaces) ? data.interfaces : [];
}

async function fetchNetraDashboard() {
  const response = await fetch(NETRA_DASHBOARD_URL, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Netra dashboard API gagal (${response.status})`);
  }

  return response.json();
}

async function sendAlertToDiscord(event) {
  if (!alertChannelId) {
    if (!missingConfigLogged) {
      console.warn("DISCORD_ALERT_CHANNEL_ID belum dikonfigurasi");
      missingConfigLogged = true;
    }
    return;
  }

  const channel = await client.channels.fetch(alertChannelId);
  if (!channel || !channel.isTextBased()) return;

  const colors = { critical: 0xff6674, warning: 0xe2b84d, info: 0x5c9fe8 };
  await channel.send({
    embeds: [
      {
        title: event.title,
        description: event.detail,
        color: colors[event.severity] || colors.info,
        fields: [
          {
            name: "Severity",
            value: event.severity.toUpperCase(),
            inline: true,
          },
          { name: "Source", value: event.source, inline: true },
        ],
        timestamp: event.createdAt,
        footer: { text: "NETRA Incident Center" },
      },
    ],
  });
}

async function pollNetraAlerts() {
  try {
    const data = await fetchNetraAlerts();
    if (!data.success || !Array.isArray(data.events)) return;

    if (!alertsInitialized) {
      data.events.forEach((event) => seenAlertIds.add(event.id));
      alertsInitialized = true;
      return;
    }

    const newEvents = data.events
      .filter((event) => !seenAlertIds.has(event.id))
      .reverse();

    for (const event of newEvents) {
      seenAlertIds.add(event.id);
      await sendAlertToDiscord(event);
    }

    trimSet(seenAlertIds);
  } catch (error) {
    console.error("NETRA ALERT POLL ERROR:", error.message);
  }
}

async function askRouter(channelId, question, context) {
  const history = conversations.get(channelId) || [];
  const contextText = formatNetraContext(context);
  const messages = [
    {
      role: "system",
      content: [
        "Kamu adalah Netra AI, asisten monitoring jaringan MikroTik.",
        "Jawab dalam Bahasa Indonesia, ringkas dan praktis.",
        "Data di bagian KONTEKS NETRA adalah hasil fetch terbaru dari router.",
        "Jika user menanyakan log terbaru, gunakan bagian LOG TERBARU dan jawab berdasarkan isinya.",
        "Jika user menanyakan uptime, gunakan bagian STATUS ROUTER dan sebutkan uptime aktualnya.",
        "Jika user menanyakan router mati, reboot, restart, startup, boot, atau shutdown, gunakan LOG TERBARU untuk mencari bukti; jika tidak ada log yang membuktikan, katakan tidak ada bukti langsung.",
        "Jika log terbaru berisi login/logout biasa, katakan itu aktivitas normal dan jelaskan waktunya.",
        "Jika user menanyakan PPP Secret, gunakan bagian PPP SECRET dan jangan mengatakan data tidak tersedia jika bagian itu berisi data.",
        "Password PPP Secret tidak pernah tersedia dan tidak boleh diminta atau ditampilkan.",
        "Jika user menanyakan interface, ether, uplink, bridge, atau VLAN, gunakan bagian INTERFACE LIVE dan jawab status aktualnya.",
        "Jangan menyuruh user menjalankan command MikroTik jika data live di konteks sudah tersedia.",
        "Jangan mengarang data yang tidak ada.",
        "Bedakan fakta dari indikasi; jangan menyatakan LOS sebagai kepastian tanpa bukti.",
        "Kamu tidak memiliki tools atau function call. Jangan mengeluarkan <thinking>, <function_calls>, <invoke>, JSON tool call, atau reasoning internal.",
        "Berikan hanya jawaban akhir yang akan dibaca user.",
        contextText,
      ].join("\n"),
    },
    ...history,
    { role: "user", content: question },
  ];

  const headers = { "Content-Type": "application/json" };
  headers.Authorization = `Bearer ${ROUTER_API_KEY}`;

  const response = await fetch(`${ROUTER_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.2,
      max_tokens: 1000,
      stream: false,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`9Router ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  return cleanRouterAnswer(
    data.choices?.[0]?.message?.content ||
      "9Router tidak mengembalikan jawaban.",
  );
}

function formatNetraContext(context) {
  const events = Array.isArray(context.events) ? context.events : [];
  const logs = Array.isArray(context.logs) ? context.logs : [];
  const pppSecrets = Array.isArray(context.pppSecrets)
    ? context.pppSecrets
    : [];
  const interfaces = Array.isArray(context.interfaces)
    ? context.interfaces
    : [];
  const dashboard = context.dashboard || null;
  const dataNotice = context.cachedLogs
    ? "PERINGATAN: LOG DI BAWAH ADALAH CACHE TERAKHIR SAAT ROUTER MASIH TERHUBUNG, BUKAN DATA LIVE."
    : "";
  const activeConnections = Array.isArray(dashboard?.ppp?.active)
    ? dashboard.ppp.active.length
    : null;
  const routerStatus = dashboard?.router
    ? [
        `Router: ${dashboard.router.identity || "-"}`,
        `RouterOS: ${dashboard.router.routerOs || "-"}`,
        `CPU load: ${dashboard.router.cpuLoad ?? "-"}%`,
        `Uptime: ${dashboard.router.uptime || "-"}`,
        `Active PPP connections: ${activeConnections ?? "-"}`,
      ].join(" | ")
    : "- Tidak diminta atau data status router tidak tersedia.";
  const eventText = events.length
    ? events
        .map(
          (event) =>
            `- [${event.severity}] ${event.title}: ${event.detail} (${event.createdAt})`,
        )
        .join("\n")
    : "- Tidak ada incident baru.";
  const logText = logs.length
    ? logs
        .map(
          (log) =>
            `- ${log.time || "waktu tidak tersedia"} | ${log.topics || "system"} | ${log.message || "tanpa pesan"}`,
        )
        .join("\n")
    : "- Tidak ada log terbaru.";
  const pppText = pppSecrets.length
    ? pppSecrets
        .map(
          (user) =>
            `- ${user.name || "-"} | status: ${user.status || "-"} | profile: ${user.profile || "-"} | IP: ${user.ip || "-"} | uptime: ${user.uptime || "-"} | caller ID: ${user.callerId || "-"}`,
        )
        .join("\n")
    : "- Tidak diminta atau tidak ada data PPP Secret.";
  const interfaceText = interfaces.length
    ? interfaces
        .map(
          (item) =>
            `- ${item.name || "-"} | status: ${item.status || "-"} | type: ${item.type || "-"} | disabled: ${item.disabled || "false"} | MAC: ${item["mac-address"] || "-"} | MTU: ${item.mtu || "-"}`,
        )
        .join("\n")
    : "- Tidak diminta atau tidak ada data interface.";

  return `KONTEKS NETRA TERBARU\n${dataNotice}\nSTATUS ROUTER:\n${routerStatus}\nINCIDENT:\n${eventText}\nLOG TERBARU:\n${logText}\nPPP SECRET:\n${pppText}\nINTERFACE LIVE:\n${interfaceText}`;
}

function cleanRouterAnswer(answer) {
  return (
    String(answer)
      .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
      .replace(/<function_calls>[\s\S]*?<\/function_calls>/gi, "")
      .replace(/<invoke[\s\S]*?<\/invoke>/gi, "")
      .trim() || "Netra AI belum mendapatkan jawaban dari 9Router."
  );
}

function splitDiscordMessage(text) {
  const chunks = [];
  for (let index = 0; index < text.length; index += 1900) {
    chunks.push(text.slice(index, index + 1900));
  }
  return chunks.length ? chunks : ["Netra AI tidak mengembalikan jawaban."];
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const channelName = message.channel.name?.toLowerCase?.() || "";
  const mentioned = client.user && message.mentions.has(client.user);
  const scopedChannel = ["netra", "alerts", "network"].includes(channelName);
  if (!mentioned && !message.channel.isDMBased() && !scopedChannel) return;

  const question = message.content
    .replace(new RegExp(`<@!?${client.user.id}>`, "g"), "")
    .trim();
  if (!question) return;

  try {
    await message.channel.sendTyping();
    const wantsLogs =
      /log|catatan|login|logout|aktivitas|uptime|reboot|restart|startup|boot|shutdown|mati|down|offline/i.test(
        question,
      );
    const wantsPPP =
      /ppp|secret|akun|pelanggan|user|active connection|koneksi aktif|koneksi online|user online/i.test(
        question,
      );
    const wantsDashboard =
      /cpu|load|resource|memory|ram|uptime|reboot|restart|startup|boot|shutdown|mati|router|active connection|koneksi aktif|koneksi online|user online/i.test(
        question,
      );
    const wantsInterfaces =
      /interface|ether|uplink|bridge|vlan|port|link/i.test(question);
    const wantsNetworkContext =
      wantsLogs ||
      wantsPPP ||
      wantsInterfaces ||
      /alert|notice|insiden|anomali|router|mikrotik|jaringan|internet|koneksi|offline/i.test(
        question,
      );
    let data = { events: [] };
    let cachedLogs = false;

    if (wantsNetworkContext) {
      try {
        data = await fetchNetraAlerts();
      } catch (error) {
        if (!wantsLogs || lastNetraLogs.length === 0) throw error;
        cachedLogs = true;
      }
    }

    let logs = [];
    if (wantsLogs) {
      try {
        logs = (await fetchNetraLogs()).slice(0, 10);
      } catch (error) {
        if (lastNetraLogs.length === 0) throw error;
        logs = lastNetraLogs.slice(0, 10);
        cachedLogs = true;
      }
    }

    const context = {
      events: data.events?.slice(0, 10),
      logs,
      cachedLogs,
      pppSecrets: wantsPPP ? await fetchNetraPPPSecrets() : [],
      interfaces: wantsInterfaces ? await fetchNetraInterfaces() : [],
      dashboard: wantsDashboard ? await fetchNetraDashboard() : null,
    };
    const answer = await askRouter(message.channelId, question, context);
    const history = conversations.get(message.channelId) || [];
    history.push(
      { role: "user", content: question },
      { role: "assistant", content: answer },
    );
    conversations.set(message.channelId, history.slice(-10));
    for (const chunk of splitDiscordMessage(answer)) await message.reply(chunk);
  } catch (error) {
    console.error("NETRA AI ERROR:", error.message);
    await message.reply(
      "Netra AI sedang tidak bisa mengambil data atau menghubungi 9Router.",
    );
  }
});

client.once("clientReady", () => {
  console.log(`NETRA Bot online sebagai ${client.user.tag}`);
  console.log(`Router: ${ROUTER_URL}`);
  console.log(`Model: ${MODEL}`);
  void pollNetraAlerts();
  setInterval(() => void pollNetraAlerts(), 15_000);
});

if (!process.env.DISCORD_TOKEN) {
  console.error("DISCORD_TOKEN belum ada di .env");
  process.exit(1);
}

if (!ROUTER_API_KEY) {
  console.error("ROUTER_API_KEY belum ada di .env");
  process.exit(1);
}

loadNetraCache().finally(() => client.login(process.env.DISCORD_TOKEN));
