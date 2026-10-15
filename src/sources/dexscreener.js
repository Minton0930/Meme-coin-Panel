// DexScreener public API (no key). Documented limits:
//   token-profiles / token-boosts: 60 req/min
//   tokens/v1 (pairs by token, up to 30 addresses per call): 300 req/min
import { Limiter, getJson } from '../http.js';

const BASE = 'https://api.dexscreener.com';
const slow = new Limiter('dexscreener-discovery', 2_100); // ~28/min, under the 60/min cap
const fast = new Limiter('dexscreener-pairs', 400);       // up to 150/min, under the 300/min cap

export async function discover() {
  const [profiles, boosts, topBoosts] = await Promise.allSettled([
    getJson(slow, `${BASE}/token-profiles/latest/v1`),
    getJson(slow, `${BASE}/token-boosts/latest/v1`),
    getJson(slow, `${BASE}/token-boosts/top/v1`),
  ]);
  const out = new Map();
  const add = (list, kind) => {
    if (list.status !== 'fulfilled' || !Array.isArray(list.value)) return;
    for (const t of list.value) {
      if (t.chainId !== 'solana' || !t.tokenAddress) continue;
      const cur = out.get(t.tokenAddress) ?? { mint: t.tokenAddress, links: [], boosts: 0, sources: [] };
      cur.icon ??= t.icon;
      cur.description ??= t.description;
      for (const l of t.links ?? []) cur.links.push({ type: l.type ?? l.label ?? 'link', url: l.url });
      if (t.totalAmount) cur.boosts = Math.max(cur.boosts, t.totalAmount);
      cur.sources.push(kind);
      out.set(t.tokenAddress, cur);
    }
  };
  add(profiles, 'dex-profile');
  add(boosts, 'dex-boost');
  add(topBoosts, 'dex-top-boost');
  return [...out.values()];
}

// Returns Map(mint -> best pair summary) for up to 30 mints.
export async function pairsFor(mints) {
  if (!mints.length) return new Map();
  const pairs = await getJson(fast, `${BASE}/tokens/v1/solana/${mints.slice(0, 30).join(',')}`);
  const best = new Map();
  for (const p of Array.isArray(pairs) ? pairs : []) {
    const mint = p.baseToken?.address;
    if (!mint) continue;
    const prev = best.get(mint);
    if (!prev || (p.liquidity?.usd ?? 0) > (prev.liquidity?.usd ?? 0)) best.set(mint, p);
  }
  const out = new Map();
  for (const [mint, p] of best) out.set(mint, normalizePair(p));
  return out;
}

export function normalizePair(p) {
  const t = p.txns ?? {};
  return {
    name: p.baseToken?.name,
    symbol: p.baseToken?.symbol,
    dexId: p.dexId,
    pairAddress: p.pairAddress,
    url: p.url,
    priceUsd: Number(p.priceUsd) || null,
    mcap: p.marketCap ?? p.fdv ?? null,
    liqUsd: p.liquidity?.usd ?? null,
    vol5m: p.volume?.m5 ?? 0,
    vol1h: p.volume?.h1 ?? 0,
    vol24h: p.volume?.h24 ?? 0,
    buys5m: t.m5?.buys ?? 0,
    sells5m: t.m5?.sells ?? 0,
    buys1h: t.h1?.buys ?? 0,
    sells1h: t.h1?.sells ?? 0,
    change5m: p.priceChange?.m5 ?? 0,
    change1h: p.priceChange?.h1 ?? 0,
    change24h: p.priceChange?.h24 ?? 0,
    pairCreatedAt: p.pairCreatedAt ?? null,
    image: p.info?.imageUrl,
    socials: [...(p.info?.socials ?? []).map(s => ({ type: s.type, url: s.url })), ...(p.info?.websites ?? []).map(w => ({ type: 'website', url: w.url }))],
    boostsActive: p.boosts?.active ?? 0,
    updatedAt: Date.now(),
  };
}
