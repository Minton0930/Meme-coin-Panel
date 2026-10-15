// Your trades: reads the PUBLIC wallet address you enter in SETTINGS and works
// out profit and loss from on-chain swaps. Read-only. The app never holds a
// private key, never signs anything and never trades.
import { Limiter, getJson } from './http.js';
import { config } from './config.js';
import { pairsFor } from './sources/dexscreener.js';

const SOL = 'So11111111111111111111111111111111111111112';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const lim = new Limiter('wallet-rpc', 400);
const priceLim = new Limiter('jupiter-price', 5_000);

function b58len(s) {
  let bytes = [0];
  for (const ch of s) {
    let carry = B58.indexOf(ch);
    if (carry < 0) return -1;
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8; }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return bytes.length;
}

// Accepts only a public address. Anything that looks like a private key or a
// seed phrase is refused and never saved.
export function checkWalletInput(raw) {
  const v = String(raw ?? '').trim();
  if (!v) return { ok: true, value: '' };
  if (v.split(/\s+/).length >= 12 || /^\[[\d,\s]+\]$/.test(v)) return { ok: false, secret: true };
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(v)) return { ok: false };
  const n = b58len(v);
  if (n === 64) return { ok: false, secret: true };
  if (n !== 32) return { ok: false };
  return { ok: true, value: v };
}

export const walletState = { address: '', trades: [], positions: [], totals: null, solUsd: null, error: null, checkedAt: null };
const txCache = new Map(); // signature -> parsed trade or null

async function rpc(method, params) {
  const r = await getJson(lim, config.rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { jsonrpc: '2.0', id: 1, method, params } });
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

// One transaction -> a buy or sell of one token for SOL, or null.
export function parseSwap(tx, wallet) {
  if (!tx?.meta || tx.meta.err) return null;
  const keys = tx.transaction.message.accountKeys.map(k => k.pubkey ?? k);
  const wi = keys.indexOf(wallet);
  if (wi < 0) return null;
  let solDelta = (tx.meta.postBalances[wi] - tx.meta.preBalances[wi]) / 1e9;
  const tok = new Map();
  const add = (b, sign) => {
    if (b.owner !== wallet) return;
    tok.set(b.mint, (tok.get(b.mint) ?? 0) + sign * Number(b.uiTokenAmount?.uiAmount ?? 0));
  };
  (tx.meta.preTokenBalances ?? []).forEach(b => add(b, -1));
  (tx.meta.postTokenBalances ?? []).forEach(b => add(b, 1));
  solDelta += tok.get(SOL) ?? 0; // wrapped SOL counts as SOL
  tok.delete(SOL);
  const moved = [...tok.entries()].filter(([, d]) => Math.abs(d) > 0);
  if (moved.length !== 1) return null;
  const [mint, amount] = moved[0];
  if (amount > 0 && solDelta < 0) return { side: 'buy', mint, amount, sol: -solDelta };
  if (amount < 0 && solDelta > 0) return { side: 'sell', mint, amount: -amount, sol: solDelta };
  return null;
}

// Average-cost profit per sell, plus open positions.
export function buildPositions(trades, prices = new Map()) {
  const pos = new Map();
  for (const t of [...trades].sort((a, b) => a.time - b.time)) {
    const p = pos.get(t.mint) ?? { mint: t.mint, held: 0, cost: 0, bought: 0, spent: 0, received: 0, realized: 0, buys: 0, sells: 0, first: t.time, last: t.time };
    p.last = t.time;
    if (t.side === 'buy') { p.held += t.amount; p.cost += t.sol; p.bought += t.amount; p.spent += t.sol; p.buys++; t.pnl = null; }
    else {
      const share = p.held > 0 ? Math.min(1, t.amount / p.held) : 0;
      const basis = p.cost * share;
      t.pnl = share ? t.sol - basis : null; // null = bought before the history we can see
      t.pnlPct = share && basis > 0 ? (t.pnl / basis) * 100 : null;
      p.realized += t.pnl ?? 0; p.cost -= basis; p.held = Math.max(0, p.held - t.amount); p.received += t.sol; p.sells++;
    }
    pos.set(t.mint, p);
  }
  for (const p of pos.values()) {
    const px = prices.get(p.mint);
    p.value = px != null && p.held > 0 ? p.held * px : null;
    p.unrealized = p.value != null ? p.value - p.cost : null;
    if (p.held < 1e-9) p.held = 0;
  }
  return [...pos.values()].sort((a, b) => b.last - a.last);
}

async function solPrice() {
  const r = await getJson(priceLim, `https://lite-api.jup.ag/price/v3?ids=${SOL}`);
  return r?.[SOL]?.usdPrice ?? null;
}

async function refresh(getCoin) {
  const wallet = config.wallet;
  if (wallet !== walletState.address) { Object.assign(walletState, { address: wallet, trades: [], positions: [], totals: null, error: null }); txCache.clear(); }
  if (!wallet) return;
  const sigs = await rpc('getSignaturesForAddress', [wallet, { limit: 150 }]);
  for (const s of sigs.filter(s => !s.err && !txCache.has(s.signature)).slice(0, 25)) {
    try {
      const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
      const t = parseSwap(tx, wallet);
      txCache.set(s.signature, t && { ...t, sig: s.signature, time: (tx.blockTime ?? s.blockTime ?? 0) * 1000 });
    } catch (e) { walletState.error = e.message; break; }
  }
  const trades = [...txCache.values()].filter(Boolean);
  walletState.solUsd = await solPrice().catch(() => walletState.solUsd);
  const mints = [...new Set(trades.map(t => t.mint))];
  const prices = new Map();
  const missing = [];
  for (const m of mints) { const c = getCoin(m); if (c?.market?.priceNative) prices.set(m, c.market.priceNative); else missing.push(m); }
  if (missing.length) {
    const pairs = await pairsFor(missing.slice(0, 30)).catch(() => new Map());
    for (const [m, p] of pairs) if (p.priceNative) prices.set(m, p.priceNative);
  }
  const positions = buildPositions(trades, prices);
  for (const p of positions) { const c = getCoin(p.mint); p.symbol = c?.symbol ?? trades.find(t => t.mint === p.mint)?.symbol ?? null; p.image = c?.image ?? null; }
  for (const t of trades) t.symbol = positions.find(p => p.mint === t.mint)?.symbol;
  walletState.trades = trades.sort((a, b) => b.time - a.time);
  walletState.positions = positions;
  walletState.totals = {
    realized: positions.reduce((s, p) => s + p.realized, 0),
    unrealized: positions.reduce((s, p) => s + (p.unrealized ?? 0), 0),
    wins: trades.filter(t => t.pnl > 0).length, losses: trades.filter(t => t.pnl != null && t.pnl <= 0).length,
  };
  walletState.checkedAt = Date.now();
  walletState.error = null;
}

export function startWallet(getCoin) {
  const loop = async () => {
    for (;;) {
      try { await refresh(getCoin); } catch (e) { walletState.error = String(e.message ?? e); }
      await new Promise(r => setTimeout(r, config.wallet ? 20_000 : 3_000));
    }
  };
  loop();
}
