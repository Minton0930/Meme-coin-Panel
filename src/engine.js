// Keeps the coin table, schedules every data source within its rate limit,
// and recomputes scores whenever new data lands.
import { config } from './config.js';
import { riskScore, momentumScore } from './score.js';
import * as dex from './sources/dexscreener.js';
import { startPumpPortal } from './sources/pumpportal.js';
import { rugReport } from './sources/rugcheck.js';
import { mintInfo, topHolders, walletAge } from './sources/solana.js';
import { refreshCoinGecko, trendFor } from './sources/trends.js';
import { startNewsRadar, checkCoin, setWordHook } from './sources/news.js';

export const coins = new Map();
// A new watch word also checks coins launched in the last 30 minutes.
setWordHook(word => {
  for (const c of coins.values()) if (Date.now() - (c.createdAt ?? c.firstSeen) < 30 * 60_000) checkCoin(c, word);
});
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

export function upsert(mint, patch) {
  let c = coins.get(mint);
  if (!c) {
    c = { mint, firstSeen: Date.now(), sources: [], links: [], boosts: 0 };
    coins.set(mint, c);
    enrichQueue.add(mint);
    evict();
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'sources') c.sources = [...new Set([...c.sources, ...v])];
    else if (k === 'links') c.links = dedupeLinks([...c.links, ...v]);
    else c[k] = v;
  }
  rescore(c);
  return c;
}

export function rescore(c) {
  // Check news watch words as soon as we know the coin's name or ticker.
  const nameKey = `${c.name ?? ''}|${c.symbol ?? ''}`;
  if (nameKey !== '|' && nameKey !== c._nameKey) { c._nameKey = nameKey; checkCoin(c); }
  c.risk = riskScore(c);
  c.momentum = momentumScore(c);
  c.updatedAt = Date.now();
}

function dedupeLinks(l) { const s = new Set(); return l.filter(x => x?.url && !s.has(x.url) && s.add(x.url)); }

function evict() {
  if (coins.size <= config.maxCoins) return;
  // Drop the stalest, least active coins first.
  const sorted = [...coins.values()].sort((a, b) => interest(a) - interest(b));
  for (const c of sorted.slice(0, coins.size - config.maxCoins)) { coins.delete(c.mint); enrichQueue.delete(c.mint); }
}

function interest(c) {
  const age = (Date.now() - (c.createdAt ?? c.firstSeen)) / 60_000;
  return (c.market?.vol5m ?? 0) / 100 + (c.momentum?.score ?? 0) * 5 - age;
}

// ---- Enrichment: on-chain + RugCheck + dev wallet, one coin at a time ----
const enrichQueue = new Set();
const lastEnriched = new Map();
const pinned = new Set(); // coins someone has open in the UI get re-checked first

export function pin(mint) { if (coins.has(mint)) { pinned.add(mint); enrichQueue.add(mint); } }

async function enrich(mint) {
  const c = coins.get(mint);
  if (!c) return;
  lastEnriched.set(mint, Date.now());
  const jobs = [];
  jobs.push(rugReport(mint).then(rug => { c.rug = rug; if (!c.creator && rug.creator) c.creator = rug.creator; }).catch(() => {}));
  jobs.push((async () => {
    const mi = await mintInfo(mint);
    const exclude = [c.bondingCurve, c.market?.pairAddress, '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1'].filter(Boolean);
    let holders = null;
    try { holders = await topHolders(mint, mi.supply, exclude); } catch {}
    c.chain = { ...mi, holders };
  })().catch(() => {}));
  await Promise.all(jobs);
  if (c.creator && !c.dev) {
    try { c.dev = await walletAge(c.creator); } catch {}
  }
  rescore(c);
}

async function enrichLoop() {
  for (;;) {
    let next = [...pinned].find(m => Date.now() - (lastEnriched.get(m) ?? 0) > 60_000);
    if (next) pinned.delete(next);
    else {
      // pump.fun can launch a coin every second, faster than free APIs allow us
      // to check them all, so the most active unchecked coin goes first.
      let best = -Infinity;
      for (const m of enrichQueue) {
        const c = coins.get(m);
        const v = c ? interest(c) : -Infinity;
        if (v > best) { best = v; next = m; }
      }
      if (next) enrichQueue.delete(next);
    }
    if (!next) {
      // Re-check the most interesting coins every couple of minutes.
      const stale = [...coins.values()].filter(c => Date.now() - (lastEnriched.get(c.mint) ?? 0) > 120_000).sort((a, b) => interest(b) - interest(a))[0];
      if (stale) next = stale.mint;
    }
    if (next) await enrich(next).catch(() => {});
    else await sleep(500);
  }
}

// ---- Market data: DexScreener pairs, 30 coins per call, round robin ----
let rr = 0;
async function marketTick() {
  const all = [...coins.values()].sort((a, b) => interest(b) - interest(a));
  if (!all.length) return;
  // Half the batch is always the hottest coins, the rest rotates through everyone.
  const hot = all.slice(0, 15).map(c => c.mint);
  const rest = all.slice(15);
  const rot = [];
  for (let i = 0; i < 15 && rest.length; i++) rot.push(rest[(rr + i) % rest.length].mint);
  rr = rest.length ? (rr + 15) % rest.length : 0;
  const pairs = await dex.pairsFor([...new Set([...hot, ...rot])]);
  for (const [mint, p] of pairs) {
    const c = coins.get(mint);
    if (!c) continue;
    c.market = p;
    c.symbol ??= p.symbol; c.name ??= p.name; c.image ??= p.image;
    if (c.pump && /raydium|pumpswap|meteora|orca/i.test(p.dexId)) c.pump.graduated = true;
    rescore(c);
  }
}

async function discoverTick() {
  const found = await dex.discover();
  for (const t of found) upsert(t.mint, { image: t.icon, links: t.links, boosts: t.boosts, sources: t.sources, description: t.description });
}

async function trendTick() {
  const top = [...coins.values()].filter(c => c.symbol).sort((a, b) => (b.momentum?.score ?? 0) - (a.momentum?.score ?? 0)).slice(0, 6);
  for (const c of top) {
    if (c.trend && Date.now() - c.trend.checkedAt < 10 * 60_000) continue;
    try { c.trend = await trendFor(c); rescore(c); } catch {}
  }
}

function every(ms, fn, name) {
  let busy = false;
  const run = async () => {
    if (busy) return; busy = true;
    try { await fn(); } catch (e) { if (process.env.DEBUG) log(`[${name}]`, e.message); }
    busy = false;
  };
  run();
  return setInterval(run, ms);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export const cadence = {
  feedPush: '1s (dashboard updates every second)',
  newLaunches: config.disablePumpportal ? 'off' : 'real time (pump.fun websocket)',
  marketData: '~1s per batch of 30 coins; hottest 15 every batch, the rest rotate',
  discovery: '~7s (DexScreener profiles and boosts)',
  rugChecks: 'each new coin queued; RugCheck ~1 per 1.5s, re-checked every ~2 min',
  trends: 'top 6 coins every 60s, cached 10 min (Reddit) / 30 min (TikTok)',
  news: 'your watch words: instant · X posts: every 15s (needs X key) · news headlines: every 2 min',
};

export function start() {
  if (!config.disablePumpportal) {
    startPumpPortal({
      log,
      onCreate: t => upsert(t.mint, {
        name: t.name, symbol: t.symbol, creator: t.creator, bondingCurve: t.bondingCurve, createdAt: t.createdAt,
        pump: { mcapSol: t.mcapSol, devBuyPct: t.devBuyPct, graduated: false }, sources: ['pump-launch'],
      }),
      onEarly: (mint, e) => { const c = coins.get(mint); if (c) { c.early = e; rescore(c); } },
      onMigrate: mint => { const c = coins.get(mint); if (c) { c.pump = { ...(c.pump ?? {}), graduated: true }; upsert(mint, { sources: ['graduated'] }); } },
    });
  }
  startNewsRadar();
  every(7_000, discoverTick, 'discover');
  every(1_000, marketTick, 'market');
  every(60_000, () => refreshCoinGecko(), 'coingecko');
  every(60_000, trendTick, 'trends');
  enrichLoop();
}
