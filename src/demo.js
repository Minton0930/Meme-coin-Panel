// Demo mode: synthetic coins so the dashboard can be tried with no network.
// Everything shown in demo mode is fake and labelled as such in the UI.
import { coins, upsert, rescore, rugWarnings } from './engine.js';
import { addWatchWord, checkCoin } from './sources/news.js';
import { buildPositions } from './wallet.js';

const WORDS = ['PEPE', 'DOGE', 'CAT', 'FROG', 'MOON', 'BONK', 'WIF', 'GIGA', 'CHAD', 'SIGMA', 'SKIBIDI', 'RIZZ', 'GOAT', 'HAMSTER', 'PNUT', 'MOODENG', 'FWOG', 'POPCAT', 'BRETT', 'TURBO'];
const SUF = ['', 'INU', 'AI', '2.0', 'CEO', 'KING', 'WIFHAT', 'SOL'];
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const addr = () => Array.from({ length: 44 }, () => pick(B58)).join('');

function spawn(forced, live) {
  const mint = addr().slice(0, 40) + 'pump';
  const sym = forced ?? pick(WORDS) + pick(SUF);
  const shady = Math.random() < 0.45;
  const graduated = !forced && !live && Math.random() < 0.4;
  const top = Array.from({ length: 12 }, () => ({ address: addr(), pct: shady ? rnd(0.8, 7) : rnd(0.3, 3), insider: shady && Math.random() < 0.3 })).sort((a, b) => b.pct - a.pct);
  const created = forced || live ? Date.now() - rnd(0, 3_000) : Date.now() - rnd(0, graduated ? 6 * 3600_000 : 600_000);
  const devAge = shady ? rnd(0.02, 3) : rnd(5, 900);
  const mcap = graduated ? rnd(80_000, 8_000_000) : rnd(4_000, 60_000);
  upsert(mint, {
    firstMcapUsd: mcap * rnd(0.45, 1.1),
    demo: true, name: `${sym} (demo)`, symbol: sym, creator: addr(), createdAt: created,
    sources: [graduated ? 'graduated' : 'pump-launch'],
    pump: { graduated, devBuyPct: rnd(0, shady ? 12 : 3) },
    market: {
      dexId: graduated ? pick(['pumpswap', 'raydium']) : 'pumpfun', priceUsd: mcap / 1e9, mcap,
      liqUsd: graduated ? mcap * rnd(0.03, 0.2) : null, vol5m: rnd(0, mcap * 0.08), vol1h: rnd(mcap * 0.05, mcap * 0.6), vol24h: mcap * rnd(0.5, 3),
      buys5m: Math.floor(rnd(0, 200)), sells5m: Math.floor(rnd(0, 150)), buys1h: 800, sells1h: 600,
      change5m: rnd(-25, 40), change1h: rnd(-70, 150), change24h: rnd(-90, 900), socials: [], boostsActive: Math.random() < 0.15 ? 10 : 0,
      url: 'https://dexscreener.com/solana', pairCreatedAt: created,
    },
    rug: {
      mintAuthority: shady && Math.random() < 0.25 ? addr() : null,
      freezeAuthority: shady && Math.random() < 0.2 ? addr() : null,
      authoritiesKnown: true, holders: top, totalHolders: Math.floor(rnd(20, 4000)),
      lpLockedPct: graduated ? (shady && Math.random() < 0.4 ? rnd(0, 60) : 100) : null,
      creatorTokenCount: shady ? Math.floor(rnd(1, 25)) : 1, creatorPast: shady ? [1, 2, 3].map(() => ({ mcap: rnd(500, 6000) })) : [{ mcap: rnd(50_000, 900_000) }, { mcap: rnd(2000, 40_000) }], insidersDetected: shady ? Math.floor(rnd(0, 6)) : 0,
      rugged: false, risks: [],
    },
    dev: { ageDays: devAge, txCount: Math.floor(rnd(3, 900)), complete: true, firstSeen: Date.now() - devAge * 86_400_000 },
    early: { final: true, windowSec: 60, devBuyPct: rnd(0, 8), devSoldPct: shady && Math.random() < 0.2 ? 8 : 0, devSoldAll: false, snipeBuys: Math.floor(rnd(0, shady ? 25 : 4)), snipePct: shady ? rnd(2, 30) : rnd(0, 3), uniqueBuyers: Math.floor(rnd(5, 120)), buys: 100, sells: 30 },
    jup: { holders: Math.floor(rnd(30, 5000)), organicScore: shady ? rnd(0, 25) : rnd(20, 90), netBuyers5m: Math.floor(rnd(shady ? -20 : -5, 40)), holderChange1h: Math.floor(rnd(-10, 120)), checkedAt: Date.now() },
    info: { twitter: Math.random() < 0.7 ? `https://x.com/${sym.toLowerCase()}_demo` : null, website: Math.random() < 0.4 ? 'https://example.com' : null, telegram: Math.random() < 0.4 ? 'https://t.me/' : null, description: `${sym} demo coin. Fake text for trying the dashboard.`, replies: Math.floor(rnd(0, 300)), kingOfHill: Math.random() < 0.1, checkedAt: Date.now() },
    bundle: { wallets: Math.floor(rnd(1, shady ? 40 : 6)), sameBlock: Math.floor(rnd(0, shady ? 12 : 3)), pct: shady ? rnd(3, 35) : rnd(0, 6), checkedAt: Date.now() },
    cluster: { checked: 10, sameAge: { n: shady ? Math.floor(rnd(2, 7)) : Math.floor(rnd(0, 3)), pct: rnd(2, 20) }, sameBal: { n: shady && Math.random() < 0.5 ? 4 : 1, pct: rnd(3, 12) }, sameFunder: { n: shady ? Math.floor(rnd(1, 6)) : 1, pct: rnd(1, 15) }, fresh: shady ? Math.floor(rnd(2, 8)) : Math.floor(rnd(0, 3)), checkedAt: Date.now() },
    gtRank: graduated && Math.random() < 0.2 ? Math.floor(rnd(1, 20)) : undefined,
    trend: { coingeckoTrending: Math.random() < 0.05, reddit: { posts1h: Math.floor(rnd(0, 6)), posts24h: Math.floor(rnd(0, 40)), top: [] }, tiktok: null, tiktokEnabled: false, checkedAt: Date.now() },
  });
}

function drift() {
  for (const c of coins.values()) {
    const m = c.market;
    if (!m) continue;
    const k = 1 + rnd(-0.04, 0.045);
    m.mcap *= k; m.priceUsd *= k;
    m.change5m = Math.max(-90, Math.min(400, m.change5m + rnd(-2, 2.2)));
    m.vol5m = Math.max(0, m.vol5m + rnd(-0.01, 0.012) * m.mcap);
    m.buys5m = Math.max(0, m.buys5m + Math.floor(rnd(-6, 7)));
    m.sells5m = Math.max(0, m.sells5m + Math.floor(rnd(-6, 6)));
    m.updatedAt = Date.now();
    rescore(c);
  }
}

// Fake "big account posts about a new pet" event, then copycat coins launch.
const PETS = ['ELSA', 'BISCUIT', 'NOVA', 'ZEUS', 'MOCHI', 'KOBE', 'LUNA', 'TURBO'];
function fakeNews() {
  const name = pick(PETS);
  const kw = name.toLowerCase();
  const text = `Say hi to ${name[0] + name.slice(1).toLowerCase()}, our new puppy (DEMO POST, not real)`;
  const info = { strong: true, source: 'social', text, url: 'https://t.me/', author: pick(['@realDonaldTrump (Truth Social) DEMO', '@WatcherGuru DEMO', '@lookonchain DEMO']), at: Date.now() };
  addWatchWord(kw, info);
  for (const c of coins.values()) checkCoin(c, { kw, ...info });
  setTimeout(() => spawn(name), 2_000 + Math.random() * 3_000);
  setTimeout(() => spawn(name + pick(['INU', 'DOG', ''])), 6_000 + Math.random() * 6_000);
}

export function startDemo() {
  setTimeout(fakeNews, 8_000);
  setInterval(fakeNews, 40_000);
  for (let i = 0; i < 40; i++) spawn();
  setInterval(() => Math.random() < 0.6 && spawn(null, true), 1_500);
  setInterval(drift, 1_000);
  // Every ~45s one coin on screen gets a fake dev dump so the RUG WARNING can be seen.
  setInterval(() => {
    const c = pick([...coins.values()].filter(x => x.risk?.score < 50));
    if (!c) return;
    c.watch = { devPeak: 4, devNow: 0.2, devSold: true, at: Date.now() };
    rescore(c);
    rugWarnings.unshift({ at: Date.now(), mint: c.mint, symbol: c.symbol, why: 'DEMO: dev sold (held 4.0%, now 0.2%)' });
  }, 45_000);
  setTimeout(() => { for (let i = 0; i < 5; i++) fakeTrade(); setInterval(fakeTrade, 35_000); }, 3_000);
}

// Fake trades for the MY TRADES page in demo mode. A new fake sell lands every ~35s.
const demoTrades = [];
function fakeTrade() {
  const list = [...coins.values()].filter(c => c.market?.priceUsd);
  if (!list.length) return;
  const c = pick(list);
  const sol = rnd(0.1, 2), amount = sol / (c.market.priceUsd / 160);
  const t0 = Date.now() - rnd(60_000, 3600_000);
  demoTrades.push({ side: 'buy', mint: c.mint, symbol: c.symbol, amount, sol, time: t0, sig: addr() + addr() });
  const mult = Math.random() < 0.65 ? rnd(1.2, 6) : rnd(0.3, 0.95);
  demoTrades.push({ side: 'sell', mint: c.mint, symbol: c.symbol, amount: amount * rnd(0.5, 1), sol: 0, mult, time: Date.now() - rnd(0, 5_000), sig: addr() + addr() });
  const s = demoTrades[demoTrades.length - 1];
  s.sol = sol * (s.amount / amount) * mult;
}
export function demoWallet() {
  const positions = buildPositions(demoTrades, new Map([...coins.values()].map(c => [c.mint, (c.market?.priceUsd ?? 0) / 160])));
  for (const p of positions) { const c = coins.get(p.mint); p.symbol = c?.symbol; p.image = c?.image; }
  for (const t of demoTrades) t.symbol ??= coins.get(t.mint)?.symbol;
  return {
    address: 'DEMO-WALLET', demo: true, solUsd: 160, error: null, checkedAt: Date.now(),
    trades: [...demoTrades].sort((a, b) => b.time - a.time), positions,
    totals: {
      realized: positions.reduce((s, p) => s + p.realized, 0), unrealized: positions.reduce((s, p) => s + (p.unrealized ?? 0), 0),
      wins: demoTrades.filter(t => t.pnl > 0).length, losses: demoTrades.filter(t => t.pnl != null && t.pnl <= 0).length,
    },
  };
}
