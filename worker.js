/* הגמל הצייץ · שווקים - stock dashboard worker
   Data: Yahoo Finance chart API (unofficial, free, delayed ~15min), refreshed by Cron into KV */
const DEFAULT_WATCHLIST = [
  { sym: "TA35.TA", name: "ת\"א 35", grp: "tlv" },
  { sym: "^TA125.TA", name: "ת\"א 125", grp: "tlv" },
  { sym: "TEVA.TA", name: "טבע", grp: "tlv" },
  { sym: "LUMI.TA", name: "בנק לאומי", grp: "tlv" },
  { sym: "POLI.TA", name: "בנק הפועלים", grp: "tlv" },
  { sym: "NICE.TA", name: "נייס", grp: "tlv" },
  { sym: "BEZQ.TA", name: "בזק", grp: "tlv" },
  { sym: "ICL.TA", name: "כימיקלים לישראל", grp: "tlv" },
  { sym: "^GSPC", name: "S&P 500", grp: "nyse" },
  { sym: "^DJI", name: "דאו ג'ונס", grp: "nyse" },
  { sym: "^IXIC", name: "נסד\"ק", grp: "nasdaq" },
  { sym: "NVDA", name: "אנבידיה", grp: "nasdaq" },
  { sym: "AAPL", name: "אפל", grp: "nasdaq" },
  { sym: "TSLA", name: "טסלה", grp: "nasdaq" },
  { sym: "MSFT", name: "מיקרוסופט", grp: "nasdaq" },
];

function json(o, s = 200) {
  return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
}
async function getWatchlist(env) {
  const s = await env.MARKETS_KV.get("watchlist");
  return s ? JSON.parse(s) : DEFAULT_WATCHLIST;
}
async function fetchQuote(item) {
  try {
    const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(item.sym) + "?interval=1d&range=1d",
      { headers: { "User-Agent": "Mozilla/5.0" } });
    const d = await r.json();
    const m = d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
    if (!m || m.regularMarketPrice == null) return { ...item, err: true };
    const prev = m.chartPreviousClose || m.previousClose || m.regularMarketPrice;
    const price = m.regularMarketPrice;
    return {
      sym: item.sym, name: item.name, grp: item.grp,
      price, prev, pct: prev ? ((price - prev) / prev) * 100 : 0,
      hi: m.regularMarketDayHigh, lo: m.regularMarketDayLow,
      cur: m.currency, t: m.regularMarketTime,
    };
  } catch (e) { return { ...item, err: true }; }
}
async function refresh(env) {
  const wl = await getWatchlist(env);
  const quotes = [];
  for (let i = 0; i < wl.length; i += 6) {
    quotes.push(...await Promise.all(wl.slice(i, i + 6).map(fetchQuote)));
  }
  await env.MARKETS_KV.put("quotes", JSON.stringify({ updated: Math.floor(Date.now() / 1000), quotes }));
  return quotes.length;
}

export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(refresh(env)); },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return json({ ok: true });

    if (url.pathname === "/api/quotes") {
      const s = await env.MARKETS_KV.get("quotes");
      if (!s) { await refresh(env); return json(JSON.parse(await env.MARKETS_KV.get("quotes"))); }
      return json(JSON.parse(s));
    }

    if (url.pathname === "/api/refresh") {
      const n = await refresh(env);
      return json({ ok: true, count: n, updated: Math.floor(Date.now() / 1000) });
    }

    if (url.pathname === "/api/admin" && request.method === "POST") {
      const b = await request.json().catch(() => null);
      if (!b || !env.ADMIN_SECRET || b.password !== env.ADMIN_SECRET) return json({ error: "unauthorized" }, 401);
      if (b.action === "check") return json({ ok: true });
      const wl = await getWatchlist(env);
      if (b.action === "add") {
        const it = b.payload || {};
        if (!it.sym || !it.name || !it.grp) return json({ error: "missing fields" }, 400);
        if (wl.some((x) => x.sym === it.sym)) return json({ error: "exists" }, 400);
        wl.push({ sym: it.sym, name: it.name, grp: it.grp });
        await env.MARKETS_KV.put("watchlist", JSON.stringify(wl));
        await refresh(env);
        return json({ ok: true });
      }
      if (b.action === "remove") {
        const nw = wl.filter((x) => x.sym !== b.sym);
        await env.MARKETS_KV.put("watchlist", JSON.stringify(nw));
        await refresh(env);
        return json({ ok: true });
      }
      if (b.action === "list") return json({ watchlist: wl });
      return json({ error: "bad action" }, 400);
    }

    return env.ASSETS.fetch(request);
  },
};
