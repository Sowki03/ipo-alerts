// Admin panel. Access is enforced by the database (is_admin() + row level security);
// this page only hides itself from people who aren't signed in as an admin.

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtPhone = p => "+" + p.slice(0, 2) + " " + p.slice(2, 7) + " " + p.slice(7);
const when = iso => iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "–";

const state = { hot: [], lineIdx: null, subs: [], senderOnline: false, watching: null };

// ---------- Login gate ----------
async function boot() {
  const gate = $("gate");
  if (!sb) { gate.hidden = false; gate.innerHTML = `<h2>Not set up yet</h2><p class="muted">Add the Supabase URL and anon key to <code>js/config.js</code>.</p>`; return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    gate.hidden = false;
    gate.innerHTML = `<h1>Admin login</h1>
      <p class="muted" style="margin:6px 0 16px">We'll email you a login link.</p>
      <form id="loginForm" class="stack"><input class="input" id="email" type="email" placeholder="you@example.com" required autocomplete="email">
      <button class="btn btn-primary">Email me a login link</button><div class="note" id="loginNote"></div></form>`;
    $("loginForm").onsubmit = async e => {
      e.preventDefault();
      const { error } = await sb.auth.signInWithOtp({ email: $("email").value.trim(), options: { emailRedirectTo: location.href.split("#")[0], shouldCreateUser: true } });
      $("loginNote").className = "note " + (error ? "err" : "ok");
      $("loginNote").textContent = error ? error.message : "Check your inbox and tap the link on this device.";
    };
    return;
  }
  const { data: ok } = await sb.rpc("is_admin");
  if (!ok) {
    gate.hidden = false;
    gate.innerHTML = `<h2>No admin access</h2><p class="muted"><b>${esc(session.user.email)}</b> isn't in the <code>admins</code> table.</p><button class="btn btn-ghost" id="out2" style="margin-top:12px">Sign out</button>`;
    $("out2").onclick = signOut;
    return;
  }
  $("who").textContent = session.user.email;
  $("app").hidden = false;
  loadAll();
  setInterval(loadSender, 10000);
  setInterval(loadSubs, 30000);
}
async function signOut() { await sb.auth.signOut(); location.reload(); }
$("signOut").onclick = signOut;

function loadAll() { loadSender(); loadSubs(); loadHistory(); }

// ---------- PC sender status ----------
async function loadSender() {
  const { data: s } = await sb.from("sender_status").select("*").eq("id", 1).single();
  const online = s && s.last_seen && Date.now() - new Date(s.last_seen) < 60000;
  state.senderOnline = online && s.wa_state === "ready";
  const b = $("senderBadge");
  if (!online) { b.className = "badge"; b.lastElementChild.textContent = "PC sender: offline"; }
  else if (s.wa_state === "ready") { b.className = "badge ok"; b.lastElementChild.textContent = `PC sender: ready (+${s.wa_number})`; }
  else { b.className = "badge warn"; b.lastElementChild.textContent = s.wa_state === "qr" ? "PC sender: scan QR" : `PC sender: ${s.wa_state}`; }
  $("qrCard").hidden = !(online && s.wa_state === "qr" && s.qr);
  if (online && s.qr) $("qrImg").src = s.qr;
  renderWelcome();
  updateSendButtons();
}

function updateSendButtons() {
  const active = state.subs.filter(s => s.status === "active").length;
  $("sendPc").disabled = !state.senderOnline || !active || !!state.watching;
  $("sendPc").textContent = `Send to all ${active}`;
  if (!state.senderOnline && !state.watching) $("pcNote").textContent = "PC sender is offline. Start it on your PC, or use the phone option.";
  else if (!state.watching && $("pcNote").textContent.startsWith("PC sender is offline")) $("pcNote").textContent = "";
}

// ---------- Fetch IPOs + build the message ----------
$("fetchBtn").onclick = async () => {
  $("fetchBtn").disabled = true; $("fetchNote").textContent = "Fetching…";
  try {
    const { all, hot } = await fetchOpenIPOs();
    state.hot = hot;
    $("fetchNote").textContent = `${hot.length} of ${all.length} open IPOs are above ${GMP_THRESHOLD}% GMP.`;
    $("ipoTable").hidden = !all.length;
    $("ipoRows").innerHTML = all.sort((a, b) => b.pct - a.pct).map(r => `<tr class="ipo-row ${r.pct > GMP_THRESHOLD ? "hot" : ""}">
      <td>${esc(r.name)}${r.category && r.category !== "IPO" ? ` <span class="hint">${esc(r.category)}</span>` : ""}</td>
      <td class="pct">${r.pct.toFixed(1)}%</td><td>${r.minInvest ? inr(r.minInvest) : "–"}</td>
      <td>${new Date(r.close + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</td><td>${esc(r.sub)}</td></tr>`).join("");
    await composeMessage();
  } catch (e) {
    $("fetchNote").textContent = "Couldn't fetch IPOs: " + e.message;
  } finally { $("fetchBtn").disabled = false; }
};

async function composeMessage() {
  state.lineIdx = null;
  let line = "";
  if (!state.hot.length) {
    const { data } = await sb.from("campaigns").select("line_idx").not("line_idx", "is", null).order("created_at", { ascending: false }).limit(30);
    const pick = pickNothingLine((data || []).map(r => r.line_idx));
    state.lineIdx = pick.idx; line = pick.line;
  }
  $("msg").value = buildMessage(state.hot, line);
  $("newLine").hidden = !!state.hot.length;
  $("composeCard").hidden = false;
  $("phoneNote").textContent = ""; $("pcNote").textContent = "";
  updateSendButtons();
}
$("newLine").onclick = composeMessage;

// ---------- Send from PC (the sender picks up queued campaigns) ----------
$("sendPc").onclick = async () => {
  const active = state.subs.filter(s => s.status === "active").length;
  if (!confirm(`Send this message to ${active} friends from your PC?`)) return;
  const { data, error } = await sb.from("campaigns").insert({
    mode: "pc", message: $("msg").value, line_idx: state.lineIdx, hot_count: state.hot.length, total: active,
  }).select().single();
  if (error) { $("pcNote").textContent = error.message; return; }
  watchCampaign(data.id);
};

function watchCampaign(id) {
  state.watching = id; updateSendButtons();
  $("prog").hidden = false;
  const tick = async () => {
    const { data: c } = await sb.from("campaigns").select("*").eq("id", id).single();
    if (!c) return;
    $("prog").firstElementChild.style.width = (c.total ? (c.sent + c.failed) / c.total * 100 : 0) + "%";
    $("pcNote").textContent = c.status === "queued" ? "Waiting for the PC sender to pick it up…"
      : c.status === "sending" ? `Sending… ${c.sent + c.failed}/${c.total} (${c.failed} failed). Spaced out to keep your number safe.`
      : c.status === "done" ? `Done: ${c.sent} sent, ${c.failed} failed.` : `${c.status}: ${c.error || ""}`;
    if (["done", "failed", "cancelled"].includes(c.status)) {
      clearInterval(timer); state.watching = null; updateSendButtons(); loadHistory(); loadSubs();
    }
  };
  const timer = setInterval(tick, 3000); tick();
}

// ---------- Send from phone (broadcast list) ----------
const phoneText = () => fillName($("msg").value, "");
$("copyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(phoneText()); $("phoneNote").textContent = "Copied! Now open WhatsApp → your broadcast list → paste → send."; }
  catch { $("phoneNote").textContent = "Couldn't copy automatically. Select the message above and copy it."; }
};
$("openWa").onclick = e => {
  // On a phone this opens WhatsApp with the text ready; pick your broadcast list there
  e.preventDefault();
  location.href = "https://wa.me/?text=" + encodeURIComponent(phoneText());
};
$("phoneDone").onclick = async () => {
  const active = state.subs.filter(s => s.status === "active").length;
  const { error } = await sb.from("campaigns").insert({
    mode: "phone", message: $("msg").value, line_idx: state.lineIdx, hot_count: state.hot.length,
    status: "done", total: active, sent: active, finished_at: new Date().toISOString(),
  });
  $("phoneNote").textContent = error ? error.message : "Logged ✓";
  loadHistory();
};

// ---------- Subscribers + broadcast to-do ----------
async function loadSubs() {
  const { data, error } = await sb.from("subscribers").select("*").order("created_at", { ascending: false });
  if (error) { $("subRows").innerHTML = `<tr><td colspan="6" class="err-t">${esc(error.message)}</td></tr>`; return; }
  state.subs = data;
  const active = data.filter(s => s.status === "active").length;
  $("subCount").textContent = `(${active} active${data.length > active ? `, ${data.length - active} stopped` : ""})`;
  $("subRows").innerHTML = data.length ? data.map(s => `<tr>
    <td>${esc(s.name) || "–"}</td><td>${fmtPhone(s.phone)}</td>
    <td class="s-${s.status}">${s.status === "active" ? "active" : "stopped"}${s.last_error ? `<div class="err-t">${esc(s.last_error)}</div>` : ""}</td>
    <td>${when(s.created_at)}</td><td>${when(s.last_sent_at)}</td>
    <td><button class="btn btn-ghost btn-sm" data-toggle="${s.id}">${s.status === "active" ? "Stop" : "Restart"}</button></td></tr>`).join("")
    : `<tr><td colspan="6" class="muted">No subscribers yet. Share your signup link!</td></tr>`;

  const toAdd = data.filter(s => s.status === "active" && !s.in_broadcast);
  const toRemove = data.filter(s => s.status !== "active" && s.in_broadcast);
  $("bcAdd").innerHTML = toAdd.length
    ? `<div class="hint" style="margin:6px 0">Add to broadcast list (${toAdd.length})</div>` + toAdd.map(s => bcItem(s, "add")).join("")
    : `<p class="note ok">Everyone active is in your broadcast list ✓</p>`;
  $("bcRemove").innerHTML = toRemove.length
    ? `<div class="hint" style="margin:14px 0 6px">Remove from broadcast list (${toRemove.length})</div>` + toRemove.map(s => bcItem(s, "remove")).join("") : "";
  renderWelcome();
  updateSendButtons();
}

// ---------- Welcome not received ----------
// Same text the PC sender uses (sender/sender.js WELCOME): keep the two in sync
const WELCOME = `👋 *Hey {name}!* You're on Sowki's IPO alert list now 🎉\n\n` +
  `Whenever an IPO is worth a look, you'll get a short morning message with how much you need to apply and what you could make.`;
const welcomeError = s => (s.last_error || "").startsWith("welcome:") ? s.last_error.slice(8).trim() : "";
const notOnWa = s => welcomeError(s) === "Number not on WhatsApp";

function renderWelcome() {
  const list = state.subs.filter(s => s.status === "active" && (!s.welcomed_at || welcomeError(s)));
  const retryable = list.filter(s => s.welcomed_at && !notOnWa(s));
  $("welCount").textContent = list.length ? `(${list.length})` : "";
  $("welAllPc").hidden = !(state.senderOnline && retryable.length > 1);
  $("welList").innerHTML = list.length ? list.map(s => {
    const waiting = !s.welcomed_at;
    const why = welcomeError(s);
    const status = notOnWa(s) ? "❌ This number isn't on WhatsApp"
      : waiting ? (state.senderOnline ? "⏳ Sending in a few seconds…" : "⏳ Waiting: goes out when the PC sender is on")
      : `❌ Didn't go out${why ? `: ${esc(why)}` : ""}`;
    const pcBtn = !waiting && !notOnWa(s)
      ? `<button class="btn btn-primary btn-sm" data-welpc="${s.id}" ${state.senderOnline ? "" : "disabled title='PC sender is offline'"}>From PC</button>` : "";
    const phoneBtn = notOnWa(s) ? ""
      : `<a class="btn btn-ghost btn-sm" data-welphone="${s.id}" target="_blank" rel="noopener" href="https://wa.me/${s.phone}?text=${encodeURIComponent(fillName(WELCOME, s.name))}">From phone</a>`;
    return `<div class="add-item"><div><b>${esc(s.name) || "No name"}</b><span class="muted">${fmtPhone(s.phone)}</span><div class="hint">${status}</div></div>
      <div class="row">${pcBtn}${phoneBtn}<button class="btn btn-ghost btn-sm" data-weldone="${s.id}" title="Remove from this list">✕</button></div></div>`;
  }).join("") : `<p class="note ok">Everyone has got their welcome ✓</p>`;
}

// From PC: put it back in the sender's queue (it checks every 5 seconds)
async function queueWelcome(ids) {
  await sb.from("subscribers").update({ welcomed_at: null, last_error: null }).in("id", ids);
  loadSubs();
  setTimeout(loadSubs, 10000 + ids.length * 6000); // check again once the sender has had time
}
$("welAllPc").onclick = () => queueWelcome(state.subs.filter(s => s.status === "active" && s.welcomed_at && welcomeError(s) && !notOnWa(s)).map(s => s.id));

// From phone (WhatsApp opens with the text ready) or ✕: count it as done
async function markWelcomed(id) {
  await sb.from("subscribers").update({ welcomed_at: new Date().toISOString(), last_error: null }).eq("id", id);
  loadSubs();
}
document.addEventListener("click", e => {
  const a = e.target.closest("[data-welphone]");
  if (a) setTimeout(() => markWelcomed(a.dataset.welphone), 500); // let the link open first
});
const bcItem = (s, kind) => `<div class="add-item"><div><b>${esc(s.name) || "No name"}</b><span class="muted">${fmtPhone(s.phone)}</span></div>
  <div class="row"><button class="btn btn-ghost btn-sm" data-copy="+${s.phone}">Copy</button>
  <button class="btn btn-primary btn-sm" data-bc="${s.id}" data-val="${kind === "add"}">${kind === "add" ? "Added ✓" : "Removed ✓"}</button></div></div>`;

document.addEventListener("click", async e => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.copy) { await navigator.clipboard.writeText(t.dataset.copy).catch(() => {}); t.textContent = "Copied"; setTimeout(() => t.textContent = "Copy", 1500); }
  if (t.dataset.bc) { await sb.from("subscribers").update({ in_broadcast: t.dataset.val === "true" }).eq("id", t.dataset.bc); loadSubs(); }
  if (t.dataset.welpc) { t.disabled = true; queueWelcome([t.dataset.welpc]); }
  if (t.dataset.weldone) markWelcomed(t.dataset.weldone);
  if (t.dataset.toggle) {
    const s = state.subs.find(x => x.id === t.dataset.toggle);
    const stop = s.status === "active";
    if (stop && !confirm(`Stop sending alerts to ${s.name || fmtPhone(s.phone)}?`)) return;
    await sb.from("subscribers").update(stop ? { status: "unsubscribed", unsubscribed_at: new Date().toISOString() } : { status: "active", unsubscribed_at: null }).eq("id", s.id);
    loadSubs();
  }
});

// ---------- History ----------
async function loadHistory() {
  const { data } = await sb.from("campaigns").select("*").order("created_at", { ascending: false }).limit(15);
  $("histRows").innerHTML = data && data.length ? data.map(c => `<tr><td>${when(c.created_at)}</td>
    <td>${c.mode === "pc" ? "💻 PC" : "📱 Phone"}</td><td>${c.hot_count || "none"}</td>
    <td>${c.mode === "phone" ? "sent from phone" : c.status === "done" ? `${c.sent} sent${c.failed ? `, ${c.failed} failed` : ""}` : esc(c.status)}</td></tr>`).join("")
    : `<tr><td colspan="4" class="muted">Nothing sent yet.</td></tr>`;
  const running = data && data.find(c => c.mode === "pc" && ["queued", "sending"].includes(c.status));
  if (running && !state.watching) watchCampaign(running.id);
}

boot();
