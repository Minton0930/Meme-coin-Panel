// More free, keyless data sources.
//  - Jupiter token API: holder count, organic-activity score, audit (authorities,
//    top-holder %, dev balance, dev launches), icon and socials. 50 coins per call.
//  - pump.fun coin info (unofficial public endpoint): image, X / Telegram / website,
//    comment count, "king of the hill", bonding-curve progress.
//  - GeckoTerminal trending pools on Solana (30 calls/min free).
import { Limiter, getJson } from '../http.js';

const jupLim = new Limiter('jupiter', 1_100);
const pumpLim = new Limiter('pumpfun-info', 350);
const gtLim = new Limiter('geckoterminal', 2_500);

export async function jupiterInfo(mints) {
  if (!mints.length) return new Map();
  const r = await getJson(jupLim, `https://lite-api.jup.ag/tokens/v2/search?query=${mints.slice(0, 50).join(',')}`);
  const out = new Map();
  for (const t of Array.isArray(r) ? r : []) {
    if (!t.id) continue;
    const a = t.audit ?? {};
    out.set(t.id, {
      icon: t.icon, twitter: t.twitter, telegram: t.telegram, website: t.website,
      holders: t.holderCount ?? null,
      organicScore: t.organicScore ?? null, organicLabel: t.organicScoreLabel ?? null,
      verified: !!t.isVerified,
      mintDisabled: a.mintAuthorityDisabled, freezeDisabled: a.freezeAuthorityDisabled,
      topHoldersPct: a.topHoldersPercentage ?? null, devBalancePct: a.devBalancePercentage ?? null, devMints: a.devMints ?? null,
      traders5m: t.stats5m?.numTraders ?? null, netBuyers5m: t.stats5m?.numNetBuyers ?? null, holderChange1h: t.stats1h?.holderChange ?? null,
      checkedAt: Date.now(),
    });
  }
  return out;
}

export async function pumpInfo(mint) {
  const r = await getJson(pumpLim, `https://frontend-api-v3.pump.fun/coins/${mint}`, { timeoutMs: 8_000 });
  return {
    image: r.image_uri, twitter: r.twitter, telegram: r.telegram, website: r.website, description: r.description,
    replies: r.reply_count ?? null, kingOfHill: !!r.king_of_the_hill_timestamp, complete: !!r.complete,
    usdMcap: r.usd_market_cap ?? null, checkedAt: Date.now(),
  };
}

export async function geckoTrending() {
  const r = await getJson(gtLim, 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools?page=1');
  return (r.data ?? []).map((p, i) => ({
    rank: i + 1,
    mint: String(p.relationships?.base_token?.data?.id ?? '').replace(/^solana_/, ''),
    name: p.attributes?.name,
  })).filter(x => x.mint);
}
