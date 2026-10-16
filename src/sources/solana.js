// Direct Solana RPC checks: mint/freeze authority straight from chain,
// largest holders (resolved to owner wallets), and wallet age/activity.
import { Limiter, getJson } from '../http.js';
import { config, isPublicRpc } from '../config.js';

// Public mainnet RPC allows roughly 40 req/10s per method and is stricter on
// getTokenLargestAccounts; a keyed provider can go much faster.
const lim = new Limiter('solana-rpc', isPublicRpc() ? 350 : 60);
let id = 0;

async function rpc(method, params) {
  lim.minIntervalMs = isPublicRpc() ? 350 : 60; // the RPC can be changed live in SETTINGS
  const r = await getJson(lim, config.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { jsonrpc: '2.0', id: ++id, method, params },
  });
  if (r.error) throw new Error(`${method}: ${r.error.message}`);
  return r.result;
}

export async function mintInfo(mint) {
  const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
  const info = r?.value?.data?.parsed?.info;
  if (!info) throw new Error('not a parsed mint');
  return {
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    supply: Number(info.supply) / 10 ** info.decimals,
    decimals: info.decimals,
    program: r.value.owner,
    tricks: token2022Tricks(info.extensions ?? []),
  };
}

// Token-2022 extensions used as honeypots: a permanent delegate can take or burn
// your tokens, a transfer hook can block sells, a transfer fee can eat each sale,
// and a default-frozen state means new holders start frozen.
export function token2022Tricks(exts) {
  const out = [];
  for (const e of exts) {
    const st = e.state ?? {};
    if (e.extension === 'permanentDelegate' && st.delegate) out.push({ key: 'delegate', bad: true, text: 'permanent delegate (someone can take or burn your coins)' });
    if (e.extension === 'transferHook' && st.programId) out.push({ key: 'hook', bad: true, text: 'custom transfer hook (can block sells)' });
    if (e.extension === 'transferFeeConfig') {
      const bps = Number(st.newerTransferFee?.transferFeeBasisPoints ?? st.olderTransferFee?.transferFeeBasisPoints ?? 0);
      if (bps > 0) out.push({ key: 'fee', bad: bps >= 500 || !!st.transferFeeConfigAuthority, text: `${(bps / 100).toFixed(1)}% fee on every transfer${st.transferFeeConfigAuthority ? ', and the dev can raise it' : ''}` });
    }
    if (e.extension === 'defaultAccountState' && /frozen/i.test(st.accountState ?? '')) out.push({ key: 'frozen', bad: true, text: 'new holders start FROZEN' });
    if (e.extension === 'pausableConfig' && st.authority) out.push({ key: 'pause', bad: true, text: 'dev can pause all transfers' });
  }
  return out;
}

// Bundle check: which wallets bought in the same block as the launch, or the
// next 2 blocks, and how much of the supply they took. Launch bundles (often
// 20-50 fresh wallets funded by one source) are the most common rug setup.
// Only practical for young coins: we read the coin's oldest signatures.
export async function bundleCheck(mint, creator, supply) {
  let before, sigs = [], pages = 0;
  for (; pages < 3; pages++) {
    const page = await rpc('getSignaturesForAddress', [mint, { limit: 1000, ...(before && { before }) }]);
    if (!page?.length) break;
    sigs = sigs.concat(page);
    before = page[page.length - 1].signature;
    if (page.length < 1000) break;
  }
  if (!sigs.length) throw new Error('no history');
  if (pages >= 3) return { tooOld: true, checkedAt: Date.now() };
  const ok = sigs.filter(s => !s.err);
  const firstSlot = Math.min(...ok.map(s => s.slot));
  const early = ok.filter(s => s.slot <= firstSlot + 2).sort((a, b) => a.slot - b.slot).slice(0, 25);
  const buyers = new Map();
  let sameBlock = 0;
  for (const s of early) {
    const tx = await rpc('getTransaction', [s.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
    if (!tx?.meta) continue;
    const pre = new Map((tx.meta.preTokenBalances ?? []).filter(b => b.mint === mint).map(b => [b.owner, Number(b.uiTokenAmount?.uiAmount ?? 0)]));
    for (const b of tx.meta.postTokenBalances ?? []) {
      if (b.mint !== mint || !b.owner || b.owner === creator) continue;
      const got = Number(b.uiTokenAmount?.uiAmount ?? 0) - (pre.get(b.owner) ?? 0);
      if (got <= 0 || (supply && got / supply > 0.5)) continue; // skip the bonding curve / pool itself
      buyers.set(b.owner, (buyers.get(b.owner) ?? 0) + got);
      if (s.slot === firstSlot) sameBlock++;
    }
  }
  const total = [...buyers.values()].reduce((a, b) => a + b, 0);
  return {
    wallets: buyers.size,
    sameBlock,
    pct: supply ? (total / supply) * 100 : 0,
    checkedAt: Date.now(),
  };
}

// Top holders by owner wallet, with the given addresses (pool, curve) excluded.
export async function topHolders(mint, supply, exclude = []) {
  const largest = await rpc('getTokenLargestAccounts', [mint, { commitment: 'confirmed' }]);
  const accts = largest?.value ?? [];
  if (!accts.length) return [];
  const infos = await rpc('getMultipleAccounts', [accts.map(a => a.address), { encoding: 'jsonParsed' }]);
  const byOwner = new Map();
  accts.forEach((a, i) => {
    const owner = infos?.value?.[i]?.data?.parsed?.info?.owner ?? a.address;
    if (exclude.includes(owner) || exclude.includes(a.address)) return;
    byOwner.set(owner, (byOwner.get(owner) ?? 0) + Number(a.uiAmount ?? 0));
  });
  return [...byOwner.entries()]
    .map(([address, amt]) => ({ address, pct: supply ? (amt / supply) * 100 : 0 }))
    .sort((a, b) => b.pct - a.pct);
}

// Oldest transaction we can see = approximate wallet creation time.
// Pages back at most 3 x 1000 signatures; a very busy wallet reports "older than".
export async function walletAge(address) {
  let before, oldest = null, count = 0, complete = false;
  for (let page = 0; page < 3; page++) {
    const sigs = await rpc('getSignaturesForAddress', [address, { limit: 1000, ...(before && { before }) }]);
    if (!sigs?.length) { complete = true; break; }
    count += sigs.length;
    const last = sigs[sigs.length - 1];
    oldest = last.blockTime ? last.blockTime * 1000 : oldest;
    before = last.signature;
    if (sigs.length < 1000) { complete = true; break; }
  }
  return {
    firstSeen: oldest,
    ageDays: oldest ? (Date.now() - oldest) / 86_400_000 : null,
    txCount: count,
    complete, // false means the wallet is at least this old and has 3000+ txs
    checkedAt: Date.now(),
  };
}

// How many of this coin's tokens a wallet holds right now (all its token accounts).
export async function walletTokenBalance(owner, mint) {
  const r = await rpc('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }]);
  return (r?.value ?? []).reduce((s, a) => s + Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0);
}

// Top-10 cluster check. One person running many wallets usually shows up as:
// wallets created within the same hour or two, holding near-identical amounts,
// or funded with their first SOL by the same wallet. Costs ~2 RPC calls per wallet.
export async function holderCluster(holders) {
  const top = holders.filter(h => h.pct >= 0.3).slice(0, 10);
  const info = [];
  for (const h of top) {
    const sigs = await rpc('getSignaturesForAddress', [h.address, { limit: 1000 }]);
    if (!sigs?.length) continue;
    const old = sigs.length >= 1000; // busy wallet: older than this page, not a throwaway
    const first = sigs[sigs.length - 1];
    let funder = null;
    if (!old) {
      try {
        const tx = await rpc('getTransaction', [first.signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }]);
        const keys = tx?.transaction?.message?.accountKeys?.map(k => k.pubkey ?? k) ?? [];
        // Whoever paid for the wallet's first transaction (or sent it SOL) funded it.
        funder = keys[0] !== h.address ? keys[0] : (tx?.meta?.preBalances ?? []).map((b, i) => [keys[i], b - (tx.meta.postBalances[i] ?? 0)]).filter(([k, d]) => k !== h.address && d > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      } catch {}
    }
    info.push({ address: h.address, pct: h.pct, born: old ? null : (first.blockTime ?? 0) * 1000, txs: sigs.length, funder });
  }
  return analyzeCluster(info);
}

export function analyzeCluster(info) {
  const young = info.filter(w => w.born);
  // Largest group of wallets created within 2 hours of each other.
  let sameAge = [];
  for (const w of young) {
    const g = young.filter(x => Math.abs(x.born - w.born) <= 2 * 3600_000);
    if (g.length > sameAge.length) sameAge = g;
  }
  // Largest group holding amounts within 3% of each other (e.g. 2.01%, 2.03%, 1.99%).
  let sameBal = [];
  for (const w of info) {
    const g = info.filter(x => Math.abs(x.pct - w.pct) <= w.pct * 0.03);
    if (g.length > sameBal.length) sameBal = g;
  }
  const byFunder = new Map();
  for (const w of info) if (w.funder) byFunder.set(w.funder, [...(byFunder.get(w.funder) ?? []), w]);
  const sameFunder = [...byFunder.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  const sum = g => g.reduce((s, w) => s + w.pct, 0);
  return {
    checked: info.length,
    sameAge: { n: sameAge.length, pct: sum(sameAge) },
    sameBal: { n: sameBal.length, pct: sum(sameBal) },
    sameFunder: { n: sameFunder.length, pct: sum(sameFunder), funder: sameFunder[0]?.funder ?? null },
    fresh: young.filter(w => Date.now() - w.born < 24 * 3600_000 && w.txs < 15).length,
    checkedAt: Date.now(),
  };
}
