// Social / trend signal. Honest about coverage:
//  - CoinGecko trending (free, no key): what crypto users are searching right now.
//  - Reddit search (free, no key, ~10 req/min unauthenticated): mention counts.
//  - TikTok: no open public API exists. If APIFY_TOKEN is set we run a TikTok
//    search through an Apify scraper actor (paid per run); otherwise TikTok is skipped.
import { Limiter, getJson } from '../http.js';
import { config } from '../config.js';

const cg = new Limiter('coingecko', 6_000);
const reddit = new Limiter('reddit', 7_000);
const apify = new Limiter('tiktok-apify', 10_000);

let cgTrending = { at: 0, names: new Set() };
const cache = new Map(); // key -> { at, data }

async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export async function refreshCoinGecko() {
  const r = await getJson(cg, 'https://api.coingecko.com/api/v3/search/trending');
  const names = new Set();
  for (const c of r.coins ?? []) {
    if (c.item?.symbol) names.add(c.item.symbol.toLowerCase());
    if (c.item?.name) names.add(c.item.name.toLowerCase());
  }
  cgTrending = { at: Date.now(), names };
}

async function redditMentions(symbol, name) {
  if (config.disableReddit) return null;
  const q = encodeURIComponent(`"$${symbol}" OR "${name}" solana`);
  return cached(`rd:${symbol}`, 10 * 60_000, async () => {
    const r = await getJson(reddit, `https://www.reddit.com/search.json?q=${q}&sort=new&t=day&limit=100`);
    const posts = r.data?.children?.map(c => c.data) ?? [];
    const hourAgo = Date.now() / 1000 - 3600;
    return {
      posts24h: posts.length,
      posts1h: posts.filter(p => p.created_utc > hourAgo).length,
      score24h: posts.reduce((s, p) => s + (p.score ?? 0), 0),
      top: posts.sort((a, b) => b.score - a.score).slice(0, 3).map(p => ({ title: p.title, url: `https://reddit.com${p.permalink}`, score: p.score })),
    };
  });
}

async function tiktokMentions(symbol, name) {
  if (!config.apifyToken) return null;
  return cached(`tt:${symbol}`, 30 * 60_000, async () => {
    const url = `https://api.apify.com/v2/acts/${config.apifyActor}/run-sync-get-dataset-items?token=${config.apifyToken}&timeout=90`;
    const items = await getJson(apify, url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { searchQueries: [`${name} coin`, `$${symbol}`], resultsPerPage: 20, searchSection: '/video' },
      timeoutMs: 100_000,
    });
    const recent = (Array.isArray(items) ? items : []).filter(v => {
      const t = Date.parse(v.createTimeISO ?? '') || (v.createTime ?? 0) * 1000;
      return Date.now() - t < 72 * 3600_000;
    });
    return {
      videos72h: recent.length,
      views72h: recent.reduce((s, v) => s + (v.playCount ?? 0), 0),
      top: recent.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0)).slice(0, 3).map(v => ({ url: v.webVideoUrl, views: v.playCount })),
    };
  });
}

export async function trendFor(coin) {
  const sym = (coin.symbol ?? '').replace(/^\$/, '');
  if (!sym) return null;
  const [rd, tt] = await Promise.allSettled([redditMentions(sym, coin.name ?? sym), tiktokMentions(sym, coin.name ?? sym)]);
  const r = rd.status === 'fulfilled' ? rd.value : null;
  const t = tt.status === 'fulfilled' ? tt.value : null;
  const onCg = cgTrending.names.has(sym.toLowerCase()) || cgTrending.names.has((coin.name ?? '').toLowerCase());
  return { reddit: r, tiktok: t, coingeckoTrending: onCg, tiktokEnabled: !!config.apifyToken, checkedAt: Date.now() };
}
