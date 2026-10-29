// sender/sender.js - PC sender for IPO Alerts.
// Keeps a WhatsApp Web session (scan the QR once), reports its status to Supabase,
// sends queued "Send from PC" campaigns one by one, welcomes new subscribers and handles STOP/START.
// Run: double-click start-sender.bat  (or: node --env-file=.env sender.js)

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY. Copy .env.example to .env and fill it in.");
  process.exit(1);
}
const STALE_MINUTES = 30; // a PC send queued longer ago than this is skipped (PC was off)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toLocaleTimeString("en-IN"), ...a);

// ---------- Supabase REST (service key bypasses row level security) ----------
async function db(pathAndQuery, { method = "GET", body, prefer } = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`Supabase ${method} ${pathAndQuery.split("?")[0]}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}
const patch = (table, filter, body) => db(`${table}?${filter}`, { method: "PATCH", body, prefer: "return=minimal" });

// ---------- Messages ----------
// Full name as they typed it ("S Pranav" stays "S Pranav"), extra spaces tidied
function fillName(message, name) {
  const full = String(name || "").trim().replace(/\s+/g, " ");
  return full ? message.replaceAll("{name}", full) : message.replaceAll(" {name}", "").replaceAll("{name}", "");
}
const WELCOME = `👋 *Hey {name}!* You're on Sowki's IPO alert list now 🎉\n\n` +
  `Whenever an IPO is worth a look, you'll get a short morning message with how much you need to apply and what you could make.`;
// (WELCOME is also in js/admin.js for "Send from phone": keep the two in sync)
const UNSUB_CODE = code => `🔐 Your code to stop IPO alerts: *${code}*\n\n` +
  `Type it on the unsubscribe page. It works for 10 minutes.\n` +
  `_Didn't ask for this? Just ignore this message, nothing will change._`;
const STOPPED = `✌️ Done! You won't get any more IPO alerts. Reply *START* anytime to come back.`;
const RESTARTED = `👋 Welcome back! IPO alerts are on again.`;

// ---------- WhatsApp ----------
const wa = { state: "starting", qr: null, number: "" };
let client, restarting = false;

// Throw away the broken browser and log in again with the saved session (no QR needed)
function restartWhatsApp(why) {
  if (restarting) return;
  restarting = true;
  wa.state = "offline"; wa.number = "";
  log(`Reconnecting WhatsApp (${why})`); heartbeat();
  const old = client;
  Promise.race([old?.destroy(), sleep(10000)]).catch(() => {}).finally(() => setTimeout(() => { restarting = false; startWhatsApp(); }, 3000));
}
// Errors that mean the hidden WhatsApp browser died (typically after the PC slept)
const BROKEN = /detached Frame|Session closed|Target closed|Protocol error|Execution context was destroyed|browser has disconnected/i;

function getChromePath() {
  const cands = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  for (const p of cands) if (fs.existsSync(p)) return p;
}

function startWhatsApp() {
  const chromePath = getChromePath();
  client = new Client({
    authStrategy: new LocalAuth({ clientId: "ipo-alerts", dataPath: path.join(HERE, ".wwebjs_auth") }),
    puppeteer: { headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"], ...(chromePath ? { executablePath: chromePath } : {}) },
  });
  client.on("qr", async qr => {
    wa.state = "qr"; wa.qr = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
    log("Scan this QR with WhatsApp → Linked devices (also shown on the admin page):");
    qrcodeTerminal.generate(qr, { small: true });
    heartbeat();
  });
  client.on("authenticated", () => {
    wa.state = "authenticating"; wa.qr = null; log("Logged in, loading chats…"); heartbeat();
    // First login after a scan sometimes never fires "ready"; a restart picks up the saved session
    setTimeout(() => {
      if (wa.state !== "authenticating") return;
      restartWhatsApp("stuck loading after login");
    }, 90 * 1000);
  });
  client.on("ready", () => {
    wa.state = "ready"; wa.qr = null; wa.number = client.info.wid.user;
    log(`WhatsApp ready as ${client.info.pushname} (+${wa.number})`); heartbeat();
  });
  client.on("auth_failure", m => { wa.state = "error"; log("Auth failure:", m); });
  client.on("disconnected", reason => {
    restartWhatsApp(`disconnected: ${reason}`);
  });
  client.on("message", msg => {
    if (msg.from.endsWith("@c.us")) handleReply(msg.from.replace("@c.us", ""), msg.body || "").catch(e => log("reply:", e.message));
  });
  client.initialize().catch(e => { wa.state = "error"; log("WhatsApp failed to start:", e.message); });
}

async function sendTo(phone, text) {
  if (wa.state !== "ready") return { ok: false, reason: "WhatsApp not connected" };
  try {
    const id = await client.getNumberId(phone);
    if (!id) return { ok: false, reason: "Number not on WhatsApp" };
    await client.sendMessage(id._serialized, text);
    return { ok: true };
  } catch (e) {
    if (BROKEN.test(e.message)) { restartWhatsApp("connection broke while sending"); return { ok: false, reason: e.message, retry: true }; }
    return { ok: false, reason: e.message };
  }
}

const waitUntilReady = async (ms = 180000) => { for (let t = 0; t < ms && wa.state !== "ready"; t += 2000) await sleep(2000); return wa.state === "ready"; };

// Every minute (and right after the PC wakes up), make sure WhatsApp still answers
let lastBeat = Date.now();
async function healthCheck() {
  if (wa.state !== "ready" || restarting) return;
  try {
    const state = await Promise.race([client.getState(), sleep(15000).then(() => "TIMEOUT")]);
    if (state !== "CONNECTED") restartWhatsApp(`health check: ${state}`);
  } catch (e) { restartWhatsApp(`health check: ${e.message}`); }
}
setInterval(() => {
  const gap = Date.now() - lastBeat; lastBeat = Date.now();
  if (gap > 60000) { log(`PC was asleep for about ${Math.round(gap / 60000)} min`); healthCheck(); }
}, 10000);
setInterval(healthCheck, 60000);

async function handleReply(phone, body) {
  const word = body.trim().toUpperCase();
  if (!["STOP", "UNSUBSCRIBE", "START"].includes(word)) return;
  const [s] = await db(`subscribers?phone=eq.${phone}&select=id,status`);
  if (!s) return;
  if (word !== "START" && s.status === "active") {
    await patch("subscribers", `id=eq.${s.id}`, { status: "unsubscribed", unsubscribed_at: new Date().toISOString() });
    await sendTo(phone, STOPPED); log(`Unsubscribed ${phone}`);
  } else if (word === "START" && s.status !== "active") {
    await patch("subscribers", `id=eq.${s.id}`, { status: "active", unsubscribed_at: null });
    await sendTo(phone, RESTARTED); log(`Resubscribed ${phone}`);
  }
}

// ---------- Status heartbeat (admin page shows online/offline) ----------
async function heartbeat() {
  try {
    await patch("sender_status", "id=eq.1", {
      last_seen: new Date().toISOString(), wa_state: wa.state, wa_number: wa.number, qr: wa.state === "qr" ? wa.qr : null,
    });
  } catch (e) { log("heartbeat:", e.message); }
}

// ---------- Work loop ----------
let busy = false;

async function runCampaign(c) {
  if (Date.now() - new Date(c.created_at) > STALE_MINUTES * 60000) {
    await patch("campaigns", `id=eq.${c.id}`, { status: "failed", error: `Not sent: queued over ${STALE_MINUTES} min ago while the PC was off`, finished_at: new Date().toISOString() });
    log("Skipped an old queued send"); return;
  }
  const subs = await db("subscribers?status=eq.active&select=id,name,phone&order=created_at.asc");
  await patch("campaigns", `id=eq.${c.id}`, { status: "sending", total: subs.length, started_at: new Date().toISOString() });
  log(`Sending to ${subs.length} subscribers…`);
  let sent = 0, failed = 0;
  for (const [i, s] of subs.entries()) {
    let r = await sendTo(s.phone, fillName(c.message, s.name));
    if (r.retry && await waitUntilReady()) r = await sendTo(s.phone, fillName(c.message, s.name)); // reconnected: try once more
    r.ok ? sent++ : failed++;
    await db("deliveries", { method: "POST", body: { campaign_id: c.id, subscriber_id: s.id, phone: s.phone, status: r.ok ? "sent" : "failed", error: r.ok ? null : r.reason }, prefer: "return=minimal" });
    await patch("subscribers", `id=eq.${s.id}`, r.ok ? { last_sent_at: new Date().toISOString(), last_error: null } : { last_error: r.reason });
    await patch("campaigns", `id=eq.${c.id}`, { sent, failed });
    log(`  ${r.ok ? "✓" : "✗"} ${s.phone}${r.ok ? "" : " - " + r.reason}`);
    if (i < subs.length - 1) await sleep(4000 + Math.random() * 5000); // gaps keep the number safe
  }
  await patch("campaigns", `id=eq.${c.id}`, { status: "done", finished_at: new Date().toISOString() });
  log(`Done: ${sent} sent, ${failed} failed`);
}

async function sendWelcomes() {
  const fresh = await db("subscribers?status=eq.active&welcomed_at=is.null&select=id,name,phone&order=created_at.asc&limit=5");
  for (const s of fresh) {
    const r = await sendTo(s.phone, fillName(WELCOME, s.name));
    if (!r.ok && r.reason !== "Number not on WhatsApp") {
      // connection problem (PC slept etc.): leave it pending so it goes out once WhatsApp is back
      await patch("subscribers", `id=eq.${s.id}`, { last_error: `welcome: ${r.reason}` });
      log(`Welcome for ${s.phone} will be retried - ${r.reason}`);
      return;
    }
    // "welcome:" errors show up in the admin page's "Welcome not received" list
    await patch("subscribers", `id=eq.${s.id}`, { welcomed_at: new Date().toISOString(), last_error: r.ok ? null : `welcome: ${r.reason}` });
    log(`Welcome ${r.ok ? "sent to" : "failed for"} ${s.phone}${r.ok ? "" : " - " + r.reason}`);
    await sleep(3000 + Math.random() * 3000);
  }
}

async function tick() {
  if (busy || wa.state !== "ready") return;
  busy = true;
  try {
    const [c] = await db("campaigns?mode=eq.pc&status=eq.queued&order=created_at.asc&limit=1");
    if (c) await runCampaign(c);
    else await sendWelcomes();
  } catch (e) { log("loop:", e.message); }
  finally { busy = false; }
}

// Unsubscribe codes are time-sensitive, so they run on their own loop and don't wait for a long send
let codesBusy = false;
async function sendUnsubCodes() {
  if (codesBusy || wa.state !== "ready") return;
  codesBusy = true;
  try {
    const since = new Date(Date.now() - 10 * 60000).toISOString();
    const codes = await db(`unsub_codes?sent_at=is.null&send_error=is.null&used_at=is.null&created_at=gt.${since}&select=id,phone,code&order=created_at.asc&limit=5`);
    for (const c of codes) {
      const r = await sendTo(c.phone, UNSUB_CODE(c.code));
      if (r.retry) break; // reconnecting: try again on the next round
      await patch("unsub_codes", `id=eq.${c.id}`, r.ok ? { sent_at: new Date().toISOString() } : { send_error: r.reason });
      log(`Unsubscribe code ${r.ok ? "sent to" : "failed for"} ${c.phone}${r.ok ? "" : " - " + r.reason}`);
    }
  } catch (e) { log("codes:", e.message); }
  finally { codesBusy = false; }
}

log("IPO Alerts sender starting…");
startWhatsApp();
heartbeat();
setInterval(heartbeat, 20000);
setInterval(sendUnsubCodes, 3000);
setInterval(tick, 5000);

process.on("SIGINT", async () => {
  wa.state = "offline"; await heartbeat();
  await client?.destroy().catch(() => {});
  process.exit(0);
});
