import { test } from 'node:test';
import assert from 'node:assert/strict';
import { riskScore, momentumScore } from '../src/score.js';
import { normalizeRug } from '../src/sources/rugcheck.js';
import { normalizePair } from '../src/sources/dexscreener.js';

const holders = pcts => pcts.map((pct, i) => ({ address: `Holder${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxx`, pct }));
const cleanCoin = () => ({
  creator: 'Dev1111111111111111111111111111111111111',
  market: { dexId: 'raydium', liqUsd: 120_000, mcap: 900_000, vol5m: 20_000, vol1h: 60_000, buys5m: 80, sells5m: 40, change5m: 8, change1h: 20, socials: [] },
  rug: { authoritiesKnown: true, mintAuthority: null, freezeAuthority: null, holders: holders([3, 2.5, 2, 1.5, 1, 1, 1, 0.8, 0.7, 0.5]), totalHolders: 2400, lpLockedPct: 100, creatorTokenCount: 1, risks: [] },
  dev: { ageDays: 200, txCount: 400, complete: true },
});

test('clean coin scores LOWER with full coverage', () => {
  const r = riskScore(cleanCoin());
  assert.equal(r.grade, 'LOWER');
  assert.equal(r.coverage, 100);
  assert.ok(r.score < 25, `score ${r.score}`);
});

test('live mint authority forces at least HIGH', () => {
  const c = cleanCoin(); c.rug.mintAuthority = 'Evil111111111111111111111111111111111111';
  const r = riskScore(c);
  assert.ok(r.score >= 60);
  assert.equal(r.factors[0].key, 'mint');
});

test('missing data is not treated as safe', () => {
  const r = riskScore({ mint: 'x' });
  assert.ok(r.score >= 25, `unknown coin scored ${r.score}`);
  assert.ok(r.coverage < 50);
});

test('concentrated holders, unlocked LP and fresh serial dev stack up to EXTREME', () => {
  const c = cleanCoin();
  c.rug.holders = holders([18, 12, 9, 8, 6, 5, 4, 3, 2, 2]);
  c.rug.lpLockedPct = 0;
  c.rug.creatorTokenCount = 14;
  c.dev = { ageDays: 0.2, txCount: 5, complete: true };
  c.early = { snipePct: 25, snipeBuys: 20, devBuyPct: 4, devSoldPct: 0, windowSec: 60 };
  assert.equal(riskScore(c).grade, 'EXTREME');
});

test('rugged flag pins score to 100', () => {
  const c = cleanCoin(); c.rug.rugged = true;
  assert.equal(riskScore(c).score, 100);
});

test('momentum rises with accelerating volume and buys', () => {
  const quiet = momentumScore({ market: { vol5m: 100, vol1h: 12_000, buys5m: 2, sells5m: 3, change5m: 0, vol24h: 0 } });
  const hot = momentumScore({ market: { vol5m: 30_000, vol1h: 60_000, buys5m: 300, sells5m: 80, change5m: 25, vol24h: 0 } });
  assert.ok(hot.score > quiet.score + 40, `${hot.score} vs ${quiet.score}`);
});

test('normalizers handle real-shaped API payloads', () => {
  const rug = normalizeRug({
    mintAuthority: null, freezeAuthority: null, totalHolders: 900, creator: 'C',
    topHolders: [{ address: 'a', owner: 'POOL', pct: 40 }, { address: 'b', owner: 'W1', pct: 5, insider: true }],
    knownAccounts: { POOL: { name: 'Raydium', type: 'AMM' } },
    markets: [{ lp: { lpLockedPct: 99.5 } }], risks: [{ name: 'Low Liquidity', level: 'danger' }],
  });
  assert.equal(rug.holders.length, 1);
  assert.equal(rug.holders[0].insider, true);
  assert.equal(rug.lpLockedPct, 99.5);
  const p = normalizePair({ baseToken: { address: 'M', symbol: 'TEST' }, dexId: 'raydium', priceUsd: '0.001', marketCap: 1e6, liquidity: { usd: 5e4 }, volume: { m5: 10, h1: 20 }, txns: { m5: { buys: 3, sells: 1 } }, priceChange: { m5: 2 } });
  assert.equal(p.symbol, 'TEST');
  assert.equal(p.buys5m, 3);
  assert.equal(p.liqUsd, 5e4);
});

test('potential is only given to checked, lower-risk coins', async () => {
  const { potentialScore } = await import('../src/score.js');
  assert.equal(potentialScore({ score: 60, coverage: 100 }, { score: 90 }), null);
  assert.equal(potentialScore({ score: 20, coverage: 50 }, { score: 90 }), null);
  assert.equal(potentialScore({ score: 20, coverage: 90 }, { score: 80 }), Math.round(80 * 0.65 + 80 * 0.35));
});

test('potential is withheld when any red flag or an unchecked bundle remains', async () => {
  const { potentialScore } = await import('../src/score.js');
  const ok = { status: 'ok', key: 'mint' };
  assert.equal(potentialScore({ score: 20, coverage: 100, factors: [ok, { key: 'bundle', status: 'bad' }] }, { score: 90 }), null);
  assert.equal(potentialScore({ score: 20, coverage: 100, factors: [ok, { key: 'bundle', status: 'unknown' }] }, { score: 90 }), null);
  assert.ok(potentialScore({ score: 20, coverage: 100, factors: [ok, { key: 'bundle', status: 'ok' }] }, { score: 90 }) > 0);
});

test('Token-2022 honeypot extensions are flagged', async () => {
  const { token2022Tricks } = await import('../src/sources/solana.js');
  const t = token2022Tricks([
    { extension: 'permanentDelegate', state: { delegate: 'Abc' } },
    { extension: 'transferFeeConfig', state: { newerTransferFee: { transferFeeBasisPoints: 1000 }, transferFeeConfigAuthority: 'X' } },
    { extension: 'metadataPointer', state: {} },
  ]);
  assert.deepEqual(t.map(x => x.key), ['delegate', 'fee']);
  assert.ok(t.every(x => x.bad));
});

test('a bundled launch blocks the coin', () => {
  const now = Date.now();
  const base = { createdAt: now, pump: {}, market: { dexId: 'pumpfun', vol1h: 0, buys5m: 0, sells5m: 0, change1h: 0 } };
  const r = riskScore({ ...base, bundle: { wallets: 30, sameBlock: 12, pct: 28 } });
  assert.equal(r.factors.find(f => f.key === 'bundle').status, 'bad');
});
