// RugCheck public report API. Gives holders (with insider flags), LP lock %,
// authorities, creator, and their own risk list. Limits are not published, so
// we stay gentle (about 1 request every 1.5s) and cache each report.
import { Limiter, getJson } from '../http.js';
import { config } from '../config.js';

const lim = new Limiter('rugcheck', 1_500);

export async function rugReport(mint) {
  const headers = config.rugcheckToken ? { authorization: `Bearer ${config.rugcheckToken}` } : {};
  const r = await getJson(lim, `https://api.rugcheck.xyz/v1/tokens/${mint}/report`, { headers, timeoutMs: 20_000 });
  return normalizeRug(r);
}

export function normalizeRug(r) {
  const markets = r.markets ?? [];
  const lpLocked = markets.length ? Math.max(...markets.map(m => m.lp?.lpLockedPct ?? 0)) : null;
  const holders = (r.topHolders ?? []).map(h => ({
    address: h.owner ?? h.address,
    pct: Number(h.pct) || 0,
    insider: !!h.insider,
  }));
  // Pool and curve accounts show up as holders; RugCheck labels known ones.
  const known = r.knownAccounts ?? {};
  const isPool = a => { const k = known[a]; return k && /AMM|POOL|CURVE|LP/i.test(String(k.type ?? k.name ?? '')); };
  const realHolders = holders.filter(h => !isPool(h.address));
  return {
    mintAuthority: r.mintAuthority ?? r.token?.mintAuthority ?? null,
    freezeAuthority: r.freezeAuthority ?? r.token?.freezeAuthority ?? null,
    authoritiesKnown: 'mintAuthority' in r || !!r.token,
    holders: realHolders.slice(0, 20),
    totalHolders: r.totalHolders ?? null,
    lpLockedPct: lpLocked,
    creator: r.creator ?? null,
    creatorBalancePct: r.creatorBalance && r.token?.supply ? (r.creatorBalance / r.token.supply) * 100 : null,
    creatorTokenCount: Array.isArray(r.creatorTokens) ? r.creatorTokens.length : null,
    insidersDetected: r.graphInsidersDetected ?? null,
    rugged: !!r.rugged,
    risks: (r.risks ?? []).map(x => ({ name: x.name, level: x.level, description: x.description, value: x.value })),
    rcScore: r.score_normalised ?? null,
    liquidityUsd: r.totalMarketLiquidity ?? null,
    fetchedAt: Date.now(),
  };
}
