// Live IPO data (InvestorGain allows browser requests) and the WhatsApp message builder.
// Used by index.html (live cards) and admin.html (message preview + send).

const GMP_THRESHOLD = 20;

function istDate(d = new Date()) { return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }); } // YYYY-MM-DD
function stripHtml(s) { return (s || "").replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, "").replace(/\s+/g, " ").trim(); }

async function fetchOpenIPOs() {
  const now = new Date(), m = now.getMonth() + 1, y = now.getFullYear();
  const fy = `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
  const url = `https://webnodejs.investorgain.com/cloud/v2/report/data-read/331/1/${m}/${y}/${fy}/0/open?search=&v=11-49`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`IPO source returned ${r.status}`);
  const j = await r.json();
  const rows = (j.reportTableData || []).map(r => {
    const gmpText = stripHtml(r["GMP"]);
    const price = parseFloat(r["Price (₹)"] || r["Price"]) || 0;
    const lot = parseInt(String(r["Lot"] || "").replace(/,/g, "")) || 0;
    const gmp = parseFloat(gmpText) || 0;
    return {
      name: stripHtml(r["~ipo_name"]),
      category: stripHtml(r["~ipo_category1"]),
      close: r["~Srt_Close"],
      price, lot, gmp,
      pct: parseFloat((gmpText.match(/\(([\d.]+)%\)/) || [])[1]) || 0,
      minInvest: price * lot,
      estListing: price ? Math.round(price + gmp) : null,
      sub: stripHtml(r["Sub"]).split(" ")[0] || "-",
    };
  });
  const hot = rows.filter(r => r.pct > GMP_THRESHOLD)
    .sort((a, b) => a.close.localeCompare(b.close) || b.pct - a.pct);
  return { all: rows, hot, fetchedAt: new Date() };
}

function oddsLine(sub) {
  const x = parseFloat(sub);
  if (!x) return "👥 Bookings just opened, early bird 🐦";
  if (x < 1) return "👥 Not even fully booked yet, good chances of getting it 🍀";
  if (x < 1.5) return "👥 About 1 person for every share so far, decent odds 🍀";
  return `👥 ${Math.round(x)} people fighting for every 1 share 🍀`;
}

// Returns the message with a {name} placeholder; fillName() swaps it per person.
function buildMessage(hot, nothingLine) {
  const inr = n => "₹" + Math.round(n).toLocaleString("en-IN");
  const today = istDate(), tomorrow = istDate(new Date(Date.now() + 864e5));
  const pretty = d => new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  if (!hot.length) return `☀️ Good morning {name}! ${nothingLine}`;
  let msg = `*☀️ Good morning {name}!*\nToday's hot IPO${hot.length > 1 ? "s" : ""} 👇\n`;
  for (const r of hot) {
    const label = r.close === today ? "⏰ *Last day today!*" : r.close === tomorrow ? "📅 *Closes tomorrow*" : `🗓️ *Closes ${pretty(r.close)}*`;
    msg += `\n${label}\n*${r.name}*\n`;
    if (r.minInvest) msg += `💰 You need ${inr(r.minInvest)} to apply\n`;
    const gain = r.gmp * r.lot;
    msg += gain > 0
      ? `📈 If it lists the way the market expects, you could make ~${inr(gain)} (${Math.round(r.pct)}%)\n`
      : `📈 If it lists the way the market expects, that's about ${Math.round(r.pct)}% profit\n`;
    msg += oddsLine(r.sub) + "\n";
  }
  return msg + `\n_⚠️ IPO investments are subject to market risks. Expected gains are not guaranteed._`;
}

// "Good morning {name}!" -> "Good morning S Pranav!" (full name as typed) or "Good morning!" when there's no name
function fillName(message, name) {
  const full = String(name || "").trim().replace(/\s+/g, " ");
  return full ? message.replaceAll("{name}", full) : message.replaceAll(" {name}", "").replaceAll("{name}", "");
}

// Pick an empty-day line not used in the recent sends
function pickNothingLine(recentIdx = []) {
  const choices = NOTHING_TODAY.map((_, i) => i).filter(i => !recentIdx.includes(i));
  const idx = choices[Math.floor(Math.random() * choices.length)] ?? 0;
  return { idx, line: NOTHING_TODAY[idx] };
}
