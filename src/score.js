// Rug-risk score (0 = fewer red flags found, 100 = extreme) and a separate
// momentum score. Neither is a buy or sell signal. Missing data is never
// treated as safe: unknown checks add part of their weight and lower coverage.

const fmtPct = n => `${(n ?? 0).toFixed(1)}%`;

function factor(key, label, max, status, points, detail) {
  return { key, label, max, status, points: Math.round(points), detail };
}

export function riskScore(c) {
  const f = [];
  const m = c.market, rug = c.rug, ch = c.chain, early = c.early, dev = c.dev, jup = c.jup?.missing ? null : c.jup;
  const jupFlag = v => (v === true ? null : v === false ? 'active' : undefined);
  const onCurve = !m || /pump/i.test(m.dexId ?? '') && !c.pump?.graduated && !m.liqUsd;

  // 1. Mint authority: if live, supply can be printed at any time.
  let mintAuth = ch?.mintAuthority !== undefined ? ch.mintAuthority : rug?.authoritiesKnown ? rug.mintAuthority : undefined;
  if (mintAuth === undefined && jup) mintAuth = jupFlag(jup.mintDisabled);
  if (mintAuth === undefined) f.push(factor('mint', 'Mint authority', 25, 'unknown', 10, 'Not checked yet'));
  else if (mintAuth) f.push(factor('mint', 'Mint authority', 25, 'bad', 25, `ACTIVE${mintAuth === 'active' ? '' : ` (${short(mintAuth)})`}: dev can mint more supply`));
  else f.push(factor('mint', 'Mint authority', 25, 'ok', 0, 'Revoked'));

  // 2. Freeze authority: if live, holders can be frozen so they cannot sell.
  let frz = ch?.freezeAuthority !== undefined ? ch.freezeAuthority : rug?.authoritiesKnown ? rug.freezeAuthority : undefined;
  if (frz === undefined && jup) frz = jupFlag(jup.freezeDisabled);
  if (frz === undefined) f.push(factor('freeze', 'Freeze authority', 25, 'unknown', 10, 'Not checked yet'));
  else if (frz) f.push(factor('freeze', 'Freeze authority', 25, 'bad', 25, `ACTIVE${frz === 'active' ? '' : ` (${short(frz)})`}: wallets can be frozen (honeypot risk)`));
  else f.push(factor('freeze', 'Freeze authority', 25, 'ok', 0, 'Revoked'));

  // 3. Holder concentration (pool / bonding-curve accounts excluded).
  const holders = rug?.holders?.length ? rug.holders : ch?.holders ?? null;
  if (!holders && jup?.topHoldersPct != null) {
    const top10 = jup.topHoldersPct;
    const p = top10 > 50 ? 20 : top10 > 35 ? 14 : top10 > 25 ? 8 : top10 > 15 ? 3 : 0;
    f.push(factor('top10', 'Top 10 holders', 20, p >= 14 ? 'bad' : p > 0 ? 'warn' : 'ok', p, `${fmtPct(top10)} of supply (Jupiter)`));
  } else if (!holders) f.push(factor('top10', 'Top 10 holders', 20, 'unknown', 8, 'Not checked yet'));
  else {
    const top10 = holders.slice(0, 10).reduce((s, h) => s + h.pct, 0);
    const top1 = holders[0]?.pct ?? 0;
    let p = top10 > 50 ? 20 : top10 > 35 ? 14 : top10 > 25 ? 8 : top10 > 15 ? 3 : 0;
    f.push(factor('top10', 'Top 10 holders', 20, p >= 14 ? 'bad' : p > 0 ? 'warn' : 'ok', p, `${fmtPct(top10)} of supply`));
    p = top1 > 15 ? 12 : top1 > 8 ? 7 : top1 > 4 ? 3 : 0;
    f.push(factor('top1', 'Largest single holder', 12, p >= 7 ? 'bad' : p > 0 ? 'warn' : 'ok', p, `${fmtPct(top1)}${holders[0] ? ` (${short(holders[0].address)})` : ''}`));
    const insiders = holders.filter(h => h.insider);
    if (insiders.length) {
      const ip = insiders.reduce((s, h) => s + h.pct, 0);
      f.push(factor('insiders', 'Linked insider wallets', 12, ip > 10 ? 'bad' : 'warn', Math.min(12, 3 + ip / 2), `${insiders.length} top holders flagged as linked, holding ${fmtPct(ip)}`));
    }
  }

  // 4. Liquidity depth and LP lock (only meaningful after leaving the bonding curve).
  if (m?.liqUsd != null) {
    const liq = m.liqUsd;
    let p = liq < 5_000 ? 15 : liq < 20_000 ? 8 : liq < 50_000 ? 3 : 0;
    f.push(factor('liq', 'Liquidity', 15, p >= 8 ? 'bad' : p ? 'warn' : 'ok', p, `$${fmtNum(liq)}${m.mcap ? `, ${((liq / m.mcap) * 100).toFixed(1)}% of mcap` : ''}`));
    if (rug?.lpLockedPct != null && !/pump/i.test(m.dexId ?? '')) {
      const lp = rug.lpLockedPct;
      p = lp < 50 ? 15 : lp < 90 ? 6 : 0;
      f.push(factor('lp', 'LP locked / burned', 15, p >= 15 ? 'bad' : p ? 'warn' : 'ok', p, `${fmtPct(lp)}${lp < 50 ? ': liquidity can be pulled' : ''}`));
    } else if (/pumpswap|pump/i.test(m.dexId ?? '')) {
      f.push(factor('lp', 'LP locked / burned', 15, 'ok', 0, 'Pump.fun migration pool (LP burned by protocol)'));
    }
  } else if (onCurve) {
    f.push(factor('liq', 'Liquidity', 15, 'warn', 5, 'Still on pump.fun bonding curve (thin, but cannot be pulled)'));
  }

  // 5. Dev / creator wallet.
  const creator = c.creator ?? rug?.creator;
  if (!creator) f.push(factor('devage', 'Dev wallet age', 10, 'unknown', 4, 'Creator unknown'));
  else if (!dev) f.push(factor('devage', 'Dev wallet age', 10, 'unknown', 4, 'Checking…'));
  else {
    const d = dev.ageDays ?? 0;
    const p = !dev.complete ? 0 : d < 1 ? 10 : d < 7 ? 6 : d < 30 ? 2 : 0;
    f.push(factor('devage', 'Dev wallet age', 10, p >= 6 ? 'bad' : p ? 'warn' : 'ok', p,
      `${dev.complete ? '' : '>'}${d < 1 ? `${(d * 24).toFixed(1)}h` : `${d.toFixed(0)}d`} old, ${dev.complete ? '' : '3000+ '}${dev.complete ? `${dev.txCount} txs` : 'txs (very active)'}`));
  }
  const serialN = rug?.creatorTokenCount ?? jup?.devMints ?? null;
  if (serialN != null && serialN > 1) {
    const n = serialN;
    f.push(factor('serial', 'Dev launched other tokens', 10, n >= 5 ? 'bad' : 'warn', n >= 10 ? 10 : n >= 5 ? 7 : 3, `${n} tokens from this creator (serial launcher)`));
  }
  const devHold = rug?.creatorBalancePct ?? jup?.devBalancePct ?? (early ? Math.max(0, early.devBuyPct - early.devSoldPct) : c.pump?.devBuyPct ?? null);
  if (devHold != null) {
    const p = devHold > 10 ? 10 : devHold > 5 ? 5 : devHold > 3 ? 2 : 0;
    f.push(factor('devhold', 'Dev holding', 10, p >= 10 ? 'bad' : p ? 'warn' : 'ok', p, fmtPct(devHold)));
  }
  if (early?.devSoldAll) f.push(factor('devsold', 'Dev dumped', 15, 'bad', 15, `Dev sold ${fmtPct(early.devSoldPct)} in the first ${early.windowSec}s`));

  // 6. Snipers / bundled buys in the first seconds (heuristic from the trade stream).
  if (early) {
    const s = early.snipePct;
    const p = s > 20 ? 15 : s > 10 ? 9 : s > 4 ? 4 : 0;
    f.push(factor('snipers', 'Snipers / bundle (first 5s)', 15, p >= 9 ? 'bad' : p ? 'warn' : 'ok', p, `${early.snipeBuys} buys took ${fmtPct(s)} of supply within 5s of launch`));
  }
  // Launch bundle: wallets that bought in the launch block or the next 2 blocks.
  // Thresholds follow Bubblemaps / SolanaTracker / Mobula: >5% of supply is a
  // warning, >=10-15% is a major red flag, 3+ wallets in the launch block is a bundle.
  const b = c.bundle;
  const young = Date.now() - (c.createdAt ?? c.firstSeen ?? 0) < 24 * 3600_000;
  if (b && !b.failed && !b.tooOld) {
    const p = b.pct >= 15 ? 25 : b.pct >= 10 ? 18 : b.pct >= 5 || b.sameBlock >= 3 ? 8 : 0;
    f.push(factor('bundle', 'Launch bundle', 25, p >= 18 ? 'bad' : p ? 'warn' : 'ok', p, `${b.wallets} wallets took ${fmtPct(b.pct)} in the first 3 blocks${b.sameBlock >= 3 ? `, ${b.sameBlock} in the launch block itself` : ''}`));
  } else if (young && c.pump) f.push(factor('bundle', 'Launch bundle', 25, 'unknown', 6, b?.failed ? 'Check failed, retrying' : 'Not checked yet'));

  // Token-2022 honeypot tricks read straight from the mint account.
  for (const t of ch?.tricks ?? []) f.push(factor('token2022', 'Token trick', 30, t.bad ? 'bad' : 'warn', t.bad ? 30 : 8, t.text));

  // Fake volume: lots of volume, few real holders or a low Jupiter organic score.
  if (m && m.vol1h > 20_000) {
    const holdersN = rug?.totalHolders ?? jup?.holders;
    const org = jup?.organicScore;
    if (org != null && org < 10) f.push(factor('washvol', 'Fake-looking volume', 10, 'warn', 8, `organic score ${org.toFixed(0)}/100 with $${fmtNum(m.vol1h)} volume in 1h`));
    else if (holdersN != null && m.liqUsd && m.vol1h > m.liqUsd * 15 && holdersN < 300) f.push(factor('washvol', 'Fake-looking volume', 10, 'warn', 8, `$${fmtNum(m.vol1h)} volume in 1h but only ${holdersN} holders and $${fmtNum(m.liqUsd)} liquidity`));
  }
  if (jup?.isSus) f.push(factor('rcdanger', 'Jupiter marks it suspicious', 15, 'bad', 15, 'Jupiter audit flag: suspicious token'));

  // Top-10 cluster: one person behind many wallets.
  const cl = c.cluster;
  const hasHolders = !!(rug?.holders?.length || ch?.holders?.length);
  if (cl && !cl.failed) {
    const parts = [], warns = [];
    if (cl.sameFunder.n >= 3) parts.push(`${cl.sameFunder.n} top wallets got their first SOL from the same wallet (${fmtPct(cl.sameFunder.pct)} of supply)`);
    else if (cl.sameFunder.n === 2 && cl.sameFunder.pct >= 3) warns.push(`2 top wallets share a funder (${fmtPct(cl.sameFunder.pct)})`);
    if (cl.sameAge.n >= 4) parts.push(`${cl.sameAge.n} top wallets were created within 2 hours of each other`);
    else if (cl.sameAge.n === 3) warns.push('3 top wallets created within 2 hours of each other');
    if (cl.sameBal.n >= 3 && cl.sameBal.pct >= 3) parts.push(`${cl.sameBal.n} top wallets hold almost the same amount (${fmtPct(cl.sameBal.pct)} together)`);
    if (cl.fresh >= 5) parts.push(`${cl.fresh} of the top ${cl.checked} wallets are brand new throwaways`);
    else if (cl.fresh >= 3) warns.push(`${cl.fresh} top wallets are brand new`);
    if (parts.length) f.push(factor('cluster', 'Top holders look like one person', 30, 'bad', 30, parts.join('; ')));
    else if (warns.length) f.push(factor('cluster', 'Top holders partly linked', 30, 'warn', 8, warns.join('; ')));
    else f.push(factor('cluster', 'Top holders look independent', 30, 'ok', 0, `${cl.checked} wallets checked: different ages, balances and funders`));
  } else if (hasHolders) f.push(factor('cluster', 'Top-holder cluster check', 30, 'unknown', 6, cl?.failed ? 'Check failed, retrying' : 'Not checked yet'));

  // Community links: a real project has an X account or Telegram.
  const all = [...(c.links ?? []), ...(m?.socials ?? [])];
  const hasX = !!(c.info?.twitter || jup?.twitter || all.some(l => /twitter|x\.com/i.test(`${l.type} ${l.url}`)));
  const hasTg = !!(c.info?.telegram || jup?.telegram || all.some(l => /telegram|t\.me/i.test(`${l.type} ${l.url}`)));
  const hasWeb = !!(c.info?.website || jup?.website || all.some(l => /website/i.test(l.type ?? '')));
  if (c.info || jup || m) {
    if (!hasX && !hasTg) f.push(factor('community', 'No community links', 15, 'bad', 15, hasWeb ? 'Website only, no X or Telegram' : 'No X, Telegram or website'));
    else f.push(factor('community', 'Community links', 15, 'ok', 0, [hasX && 'X', hasTg && 'Telegram', hasWeb && 'website'].filter(Boolean).join(', ')));
  }

  // Dev track record from the dev's earlier coins (RugCheck).
  const past = rug?.creatorPast;
  if (past && past.length >= 2) {
    const dead = past.filter(t => t.mcap < 10_000).length;
    const best = Math.max(...past.map(t => t.mcap));
    if (dead === past.length) f.push(factor('devpast', 'Dev track record', 20, 'bad', 20, `All ${past.length} of the dev's earlier coins are dead (under $10k)`));
    else if (dead / past.length >= 0.8) f.push(factor('devpast', 'Dev track record', 20, 'warn', 8, `${dead} of ${past.length} earlier coins are dead; best is $${fmtNum(best)}`));
    else f.push(factor('devpast', 'Dev track record', 20, 'ok', 0, `Best earlier coin $${fmtNum(best)} (${past.length} earlier coins)`));
  }

  // Live watchdog findings (engine.js re-checks coins on screen every ~20s).
  const w = c.watch;
  if (w?.devSold) f.push(factor('devsold', 'Dev dumped', 30, 'bad', 30, `Dev held ${fmtPct(w.devPeak)}, now ${fmtPct(w.devNow)}`));
  if (w?.dumpedPct >= 4) f.push(factor('dumpers', 'Top wallets dumping', 25, 'bad', 25, `${w.dumpers} top wallets sold ${fmtPct(w.dumpedPct)} of supply since the last check`));
  else if (w?.dumpedPct >= 2) f.push(factor('dumpers', 'Top wallets selling', 25, 'warn', 8, `${w.dumpers} top wallet(s) sold ${fmtPct(w.dumpedPct)} of supply since the last check`));

  if (rug?.insidersDetected) f.push(factor('rcinsider', 'Insider network (RugCheck)', 8, 'warn', Math.min(8, rug.insidersDetected), `${rug.insidersDetected} linked insider wallets detected`));

  // 7. Market behaviour.
  if (m && (m.buys5m + m.sells5m) > 20) {
    const ratio = m.sells5m / Math.max(1, m.buys5m);
    if (ratio > 1.7 && m.sells5m > 40) f.push(factor('dump', 'Heavy selling (5m)', 20, 'bad', 20, `${m.sells5m} sells vs ${m.buys5m} buys`));
    else if (ratio > 1.5) f.push(factor('dump', 'Sell pressure (5m)', 6, 'warn', 6, `${m.sells5m} sells vs ${m.buys5m} buys`));
  }
  if (m && m.change5m < -35) f.push(factor('crash', 'Price crash (5m)', 20, 'bad', 20, `${m.change5m.toFixed(0)}% in 5 minutes`));
  else if (m && m.change1h < -60) f.push(factor('crash', 'Price crash (1h)', 8, 'bad', 8, `${m.change1h.toFixed(0)}% in 1h`));
  const hc = rug?.totalHolders ?? jup?.holders;
  if (hc != null && hc < 50) f.push(factor('holders', 'Holder count', 5, 'warn', 5, `${hc} holders`));

  // 8. RugCheck's own danger-level findings that we did not already cover.
  const dangers = (rug?.risks ?? []).filter(r => r.level === 'danger' && !/mint|freeze|holder|LP|liquidity|creator/i.test(r.name));
  if (dangers.length) f.push(factor('rcdanger', 'Other RugCheck dangers', 15, 'bad', Math.min(15, dangers.length * 5), dangers.map(d => d.name).join(', ')));

  let score = f.reduce((s, x) => s + x.points, 0);
  const hardFail = rug?.rugged || mintAuth || frz || early?.devSoldAll || w?.devSold || w?.dumpedPct >= 4 || (ch?.tricks ?? []).some(t => t.bad);
  if (rug?.rugged) { score = 100; f.unshift(factor('rugged', 'Marked RUGGED', 100, 'bad', 100, 'RugCheck marks this token as rugged')); }
  score = Math.min(100, score);
  if (hardFail) score = Math.max(score, 60);

  const checks = ['mint', 'freeze', 'top10', 'devage'];
  const known = checks.filter(k => f.find(x => x.key === k && x.status !== 'unknown')).length + (m ? 1 : 0);
  const coverage = Math.round((known / (checks.length + 1)) * 100);

  return {
    score: Math.round(score),
    grade: score >= 75 ? 'EXTREME' : score >= 50 ? 'HIGH' : score >= 25 ? 'ELEVATED' : 'LOWER',
    coverage,
    factors: f.sort((a, b) => b.points - a.points),
  };
}

// Momentum: is attention and volume accelerating right now? Descriptive only.
export function momentumScore(c) {
  const m = c.market, t = c.trend, reasons = [];
  let s = 0;
  if (m) {
    const avg5mOfHour = (m.vol1h || 0) / 12;
    const accel = avg5mOfHour > 0 ? m.vol5m / avg5mOfHour : m.vol5m > 0 ? 3 : 0;
    if (accel > 1.5) { s += Math.min(25, accel * 6); reasons.push(`5m volume ${accel.toFixed(1)}x the hourly pace`); }
    const tx = m.buys5m + m.sells5m;
    if (tx > 30) { s += Math.min(15, tx / 10); reasons.push(`${tx} trades in 5m`); }
    const br = m.buys5m / Math.max(1, tx);
    if (tx > 10 && br > 0.6) { s += (br - 0.5) * 40; reasons.push(`${Math.round(br * 100)}% of 5m trades are buys`); }
    if (m.change5m > 5) { s += Math.min(15, m.change5m / 3); reasons.push(`+${m.change5m.toFixed(0)}% in 5m`); }
    if (m.vol1h > 50_000) { s += Math.min(10, m.vol1h / 50_000); reasons.push(`$${fmtNum(m.vol1h)} 1h volume`); }
    if (m.boostsActive) { s += 3; reasons.push(`${m.boostsActive} paid DexScreener boosts (paid promotion, not organic)`); }
  }
  if (c.early && c.early.uniqueBuyers > 40) { s += 8; reasons.push(`${c.early.uniqueBuyers} unique buyers in first minute`); }
  if (t?.coingeckoTrending) { s += 10; reasons.push('On CoinGecko trending'); }
  const j = c.jup?.missing ? null : c.jup;
  if (j?.organicScore > 30) { s += Math.min(15, j.organicScore / 6); reasons.push(`Jupiter organic activity ${Math.round(j.organicScore)}/100`); }
  if (j?.netBuyers5m > 10) { s += Math.min(8, j.netBuyers5m / 5); reasons.push(`${j.netBuyers5m} more buyers than sellers in 5m`); }
  if (j?.holderChange1h > 50) { s += Math.min(8, j.holderChange1h / 25); reasons.push(`+${j.holderChange1h} holders in 1h`); }
  if (c.gtRank) { s += Math.max(3, 14 - c.gtRank / 2); reasons.push(`#${c.gtRank} trending on GeckoTerminal`); }
  if (c.info?.kingOfHill) { s += 5; reasons.push('Was king of the hill on pump.fun'); }
  if (c.info?.replies > 50) { s += Math.min(6, c.info.replies / 50); reasons.push(`${c.info.replies} comments on pump.fun`); }
  if (t?.reddit?.posts1h > 2) { s += Math.min(10, t.reddit.posts1h * 2); reasons.push(`${t.reddit.posts1h} Reddit posts in the last hour`); }
  if (t?.tiktok?.views72h > 50_000) { s += Math.min(15, t.tiktok.views72h / 100_000); reasons.push(`${fmtNum(t.tiktok.views72h)} TikTok views (72h)`); }
  if ((c.links?.length ?? 0) + (m?.socials?.length ?? 0) === 0 && !c.info?.twitter && !c.jup?.twitter && !c.info?.website) reasons.push('No socials or website listed');
  return { score: Math.round(Math.min(100, s)), reasons };
}

export function short(a) { return a ? `${String(a).slice(0, 4)}…${String(a).slice(-4)}` : ''; }
export function fmtNum(n) {
  if (n == null) return '?';
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
}

// "High potential" filter: only coins with fewer red flags (LOW or MEDIUM risk,
// mostly checked), ranked by activity and safety together. A filter, not a forecast.
// "Potential" = fewer red flags + strong activity. It is a filter, not a forecast:
// a coin only gets one if it is LOW/MEDIUM risk, mostly checked, has NO red
// (bad) finding at all, and has passed the launch-bundle check when it applies.
export function potentialScore(risk, mom) {
  if (!risk || risk.score >= 50 || risk.coverage < 80) return null;
  const fs = risk.factors ?? [];
  if (fs.some(x => x.status === 'bad')) return null;
  if (fs.some(x => (x.key === 'bundle' || x.key === 'cluster') && x.status === 'unknown')) return null;
  return Math.round((mom?.score ?? 0) * 0.65 + (100 - risk.score) * 0.35);
}

// JUST LAUNCHED lane (coins under 5 minutes old). Most full checks need time,
// so this uses the ones that work in the first seconds: launch bundle, dev
// wallet age and history, dev's own buy, authorities, plus early growth.
// A coin with any red flag, or whose bundle/dev checks aren't done, gets null.
export function freshScore(c, risk, mom) {
  const age = Date.now() - (c.createdAt ?? c.firstSeen ?? 0);
  if (!risk || !c.pump || age > 5 * 60_000 || risk.score >= 50) return null;
  const fs = risk.factors ?? [];
  if (fs.some(x => x.status === 'bad')) return null;
  const st = k => fs.find(x => x.key === k)?.status;
  if (!st('bundle') || st('bundle') === 'unknown' || st('devage') === 'unknown' || !st('devage')) return null;
  // Learned from two rugs (Oct 15): both were minutes old, had no X or website,
  // never grew past ~$3k, and were dumped. So a just-launched coin now also needs
  // socials, real growth, and more buyers than sellers.
  const soc0 = c.info ?? c.jup ?? {};
  if (!soc0.twitter && !soc0.website) return null;
  const now0 = c.info?.usdMcap ?? c.market?.mcap, first0 = c.firstMcapUsd;
  if (!now0 || now0 < 8_000 || !first0 || now0 < first0 * 1.3) return null;
  const mk = c.market;
  if (mk && mk.buys5m + mk.sells5m > 10 && mk.sells5m >= mk.buys5m) return null;
  let s = 45 - risk.score / 2;
  const now = c.info?.usdMcap ?? c.market?.mcap, first = c.firstMcapUsd;
  if (now && first) s += Math.max(-15, Math.min(25, (now / first - 1) * 25));
  const soc = c.info ?? c.jup ?? {};
  if (soc.twitter) s += 8;
  if (soc.website) s += 4;
  if ((c.info?.replies ?? 0) > 5) s += 5;
  if (c.info?.kingOfHill) s += 10;
  if (c.newsMatch) s += 15;
  s += Math.min(10, (mom?.score ?? 0) / 8);
  return Math.max(1, Math.min(99, Math.round(s)));
}
