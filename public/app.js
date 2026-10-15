// Dashboard client. Coin names come from anyone who launches a token, so every
// value that reaches the DOM goes through esc() or textContent.
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const safeUrl = u => (/^https?:\/\//i.test(u ?? '') ? esc(u) : '');
const num = n => {
  if (n == null || Number.isNaN(n)) return '<span class="dim">–</span>';
  const a = Math.abs(n);
  return a >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : n.toFixed(0);
};
const pct = (n, d = 1) => n == null ? '<span class="dim">–</span>' : `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '+' : ''}${n.toFixed(d)}%</span>`;
const sol = (n, d = 3) => n == null ? '<span class="dim">–</span>' : `<span class="${n >= 0 ? 'up' : 'down'}">${n >= 0 ? '+' : ''}${n.toFixed(d)} SOL</span>`;
const age = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`; };
const short = a => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
const RISK_WORD = { LOWER: 'LOW', ELEVATED: 'MEDIUM', HIGH: 'HIGH', EXTREME: 'DANGER' };
const riskBadge = (score, grade) => `<span class="badge g-${esc(grade)}">${RISK_WORD[grade] ?? '…'} ${score ?? ''}</span>`;
const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json', 'x-rugradar': '1' }, body: body ? JSON.stringify(body) : undefined });
const coinImg = c => {
  const img = safeUrl(c.image);
  const letter = esc((c.symbol ?? '?')[0]);
  return img ? `<img src="${img}" alt="${letter}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="ph">${letter}</span>`;
};
// Swap a coin picture that fails to load for its first letter.
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG' || !t.closest('.tok, .dh')) return;
  const ph = document.createElement('span'); ph.className = 'ph'; ph.textContent = t.alt || '?';
  t.replaceWith(ph);
}, true);
function linkRow(c) {
  const l = c.links ?? {}, m = esc(c.mint);
  return `<span class="lk">
    ${l.twitter ? `<a class="x" href="${safeUrl(l.twitter)}" target="_blank" rel="noopener nofollow">𝕏</a>` : ''}
    ${l.telegram ? `<a href="${safeUrl(l.telegram)}" target="_blank" rel="noopener nofollow">TG</a>` : ''}
    ${l.website ? `<a href="${safeUrl(l.website)}" target="_blank" rel="noopener nofollow">WEB</a>` : ''}
    <a href="https://pump.fun/coin/${m}" target="_blank" rel="noopener">PUMP</a>
    <a href="https://dexscreener.com/solana/${m}" target="_blank" rel="noopener">CHART</a>
  </span>`;
}

let state = { coins: [], alerts: [], watch: [] }, selected = null, firstFrame = true;
const seenFeed = new Set(), alerted = new Set();

// ---------- Boot ----------
const bootLines = [
  'RUGRADAR v0.5 // solana memecoin risk terminal',
  '[ok] pump.fun launch stream ............ real time',
  '[ok] big-account radar ................. built in, nothing to type',
  '[ok] rug + bundle filter ............... risky coins never reach the feed',
  '[!!] analysis only. never trades. never asks for keys.',
  '> access granted_',
];
(async () => {
  const el = $('#bootText');
  for (const l of bootLines) { el.textContent += l + '\n'; await new Promise(r => setTimeout(r, 120)); }
  setTimeout(() => $('#boot').classList.add('gone'), 300);
})();
setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 250);

// ---------- Tabs ----------
let view = 'feed';
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  view = b.dataset.v;
  document.querySelectorAll('#tabs button').forEach(x => x.classList.toggle('on', x === b));
  $('#feedView').hidden = view !== 'feed';
  $('#tradesView').hidden = view !== 'trades';
  if (view === 'trades') loadTrades();
});

// ---------- Live stream ----------
const es = new EventSource('/api/stream');
es.onmessage = ev => {
  state = JSON.parse(ev.data);
  renderTop();
  renderRadar();
  renderFeed();
  checkAlerts();
  firstFrame = false;
};
es.onerror = () => { $('#modeTag').textContent = 'RECONNECTING'; $('#modeTag').className = 'tag'; };

function renderTop() {
  const tag = $('#modeTag');
  tag.textContent = state.demo ? 'DEMO DATA' : 'LIVE';
  tag.className = `tag ${state.demo ? 'demo' : 'live'}`;
  $('#cadence').textContent = state.demo ? 'DEMO MODE: fake coins, fake posts and fake trades, nothing here is real' : `screen updates every 1s · ${state.cadence?.radar ?? ''}`;
  $('#chatState').textContent = state.chat ? '' : '(off: needs a paid Anthropic key in SETTINGS)';
  const bar = $('#updateBar');
  if (state.update?.available) { bar.textContent = `NEW VERSION ${state.update.latest} READY: close the black window and double-click start.bat`; bar.classList.add('show'); }
  else bar.classList.remove('show');
}

function renderRadar() {
  const n = state.radar?.accounts ?? 0;
  const last = state.watch.find(w => w.source !== 'manual');
  const mine = state.watch.filter(w => w.source === 'manual').map(w => `<span class="chip manual">${esc(w.kw)}<button data-kw="${esc(w.kw)}" title="stop watching">×</button></span>`).join(' ');
  $('#radarLine').innerHTML = `watching <b>${n}</b> big accounts + news · ${last ? `latest: <span class="dim">${esc(last.author ?? '')}</span> "${esc((last.text ?? '').slice(0, 90))}" <span class="dim">${age(last.at)} ago</span>` : 'waiting for the first post…'} ${mine}`;
}
$('#radarLine').addEventListener('click', e => { const b = e.target.closest('button[data-kw]'); if (b) post(`/api/watch?kw=${encodeURIComponent(b.dataset.kw)}`, null, 'DELETE'); });
$('#watchForm').addEventListener('submit', e => {
  e.preventDefault();
  const w = $('#watchInput').value.trim();
  if (w) post('/api/watch', { word: w });
  $('#watchInput').value = '';
});

// ---------- The feed ----------
function renderFeed() {
  const list = state.coins.filter(c => c.feed).sort((a, b) => (!!b.news - !!a.news) || b.pot - a.pot).slice(0, 60);
  $('#count').textContent = `[${list.length}]`;
  if (!list.length) {
    $('#feed').innerHTML = `<div class="emptymsg">Nothing passes the filter right now. That's the filter doing its job: most new coins are bundled, sniped or dumped.<br>Coins show up here when they have fewer red flags, strong activity, and are new or being talked about. ${state.coins.length} coins are being checked.</div>`;
    return;
  }
  $('#feed').innerHTML = list.map(c => {
    const fresh = !seenFeed.has(c.mint) && !firstFrame; seenFeed.add(c.mint);
    const n = c.news;
    return `<div class="coin ${n ? 'news' : ''} ${fresh ? 'fresh' : ''}" data-m="${esc(c.mint)}">
      <div class="tok">${coinImg(c)}<div style="min-width:0"><div class="t1"><b>$${esc(c.symbol ?? '???')}</b><span class="nm">${esc(c.name)}</span></div>
        <div class="dim">${age(c.createdAt)} old · ${c.stage === 'curve' ? 'pump.fun curve' : esc(c.stage)} ${c.gtRank ? `<span class="trTag">#${c.gtRank} TRENDING</span>` : ''}</div>${linkRow(c)}</div>
        <div class="potbox"><small>POTENTIAL</small><span class="pot">${c.pot}</span>${riskBadge(c.risk, c.grade)}</div></div>
      ${n ? `<div class="post">◉ ${esc(n.author ?? (n.source === 'manual' ? 'your word' : 'news'))}: "${esc(n.text ?? n.keyword)}"</div>` : ''}
      <div class="kv">
        <div><i>MCAP</i>${num(c.mcap)}</div>
        <div><i>LIQ</i>${c.stage === 'curve' ? '<span class="dim">curve</span>' : num(c.liq)}</div>
        <div><i>5M</i>${pct(c.chg5m, 0)}</div>
        <div><i>HOLDERS</i>${c.holders ?? '…'}</div>
        <div><i>TOP 10</i>${c.top10 == null ? '…' : c.top10.toFixed(0) + '%'}</div>
      </div>
      ${c.why?.length ? `<div class="why"><span>why:</span> ${c.why.map(esc).join(' · ')}</div>` : ''}
    </div>`;
  }).join('');
}
$('#feed').addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const el = e.target.closest('[data-m]'); if (el) select(el.dataset.m);
});

// ---------- Alerts: siren for big-account matches, beep for new feed coins ----------
function checkAlerts() {
  let siren = null, newFeed = 0;
  for (const a of state.alerts) {
    if (alerted.has('n' + a.id)) continue;
    alerted.add('n' + a.id);
    if (!firstFrame && Date.now() - a.at < 60_000 && a.strong) siren ??= a;
  }
  for (const c of state.coins) if (c.feed && !alerted.has('f' + c.mint)) { alerted.add('f' + c.mint); if (!firstFrame) newFeed++; }
  if (siren) showSiren(siren);
  else if (newFeed && $('#sound').checked) beep();
}

function showSiren(a) {
  const c = state.coins.find(x => x.mint === a.mint);
  const el = $('#siren');
  el.hidden = false;
  el.innerHTML = `<div><div class="sbig">🚨 ${esc(a.author ?? 'NEWS')} POSTED "${esc(a.keyword)}" → <b>$${esc(a.symbol)}</b> ${a.secsAfterPost >= 0 ? `launched ${a.secsAfterPost}s later` : 'launched BEFORE the post (be careful)'}</div>
    <div class="sub">${esc((a.postText ?? '').slice(0, 160))} · ${c ? `rug risk ${RISK_WORD[c.grade] ?? 'checking'} ${c.risk ?? ''}` : 'rug check running'} · copycats launch fast, check before anything</div></div>
    <button class="btn closeS">CLOSE</button>`;
  el.onclick = e => { if (e.target.closest('.closeS')) { el.hidden = true; stopSiren(); } else { select(a.mint); } };
  if ($('#sound').checked) siren();
  document.title = `🚨 $${a.symbol} · RUGRADAR`;
  setTimeout(() => { document.title = 'RUGRADAR // terminal'; }, 15_000);
  if (window.Notification?.permission === 'granted') new Notification(`🚨 ${a.author ?? 'News'} → $${a.symbol}`, { body: `"${a.keyword}" matched a new coin. Check the risk first.`, requireInteraction: true });
}

let actx, sirenNodes = [];
const audio = () => (actx ??= new AudioContext());
function beep() {
  try {
    const ctx = audio(), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = 880; g.gain.value = 0.08;
    o.connect(g).connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.12);
  } catch {}
}
// Loud two-tone siren for about 4 seconds.
function siren() {
  try {
    stopSiren();
    const ctx = audio(), g = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    g.gain.value = 0.9;
    g.connect(comp).connect(ctx.destination);
    for (const type of ['sawtooth', 'square']) {
      const o = ctx.createOscillator(); o.type = type;
      const t0 = ctx.currentTime;
      for (let i = 0; i < 8; i++) { o.frequency.setValueAtTime(type === 'square' ? 1400 : 950, t0 + i * 0.5); o.frequency.linearRampToValueAtTime(type === 'square' ? 1900 : 1500, t0 + i * 0.5 + 0.25); o.frequency.linearRampToValueAtTime(type === 'square' ? 1400 : 950, t0 + i * 0.5 + 0.5); }
      o.connect(g); o.start(); o.stop(t0 + 4);
      sirenNodes.push(o);
    }
  } catch {}
}
function stopSiren() { for (const o of sirenNodes) try { o.stop(); } catch {} sirenNodes = []; }
document.addEventListener('click', () => {
  audio().resume?.();
  if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}, { once: true });

// ---------- Coin check (popup) ----------
const PLAIN = {
  rugged: () => 'Already marked as RUGGED',
  mint: f => f.status === 'ok' ? 'Dev cannot create more coins' : f.status === 'unknown' ? 'Mint authority not checked yet' : 'Dev can still create more coins (can dilute you)',
  freeze: f => f.status === 'ok' ? 'Dev cannot freeze your coins' : f.status === 'unknown' ? 'Freeze authority not checked yet' : 'Dev can freeze wallets so you cannot sell',
  bundle: f => f.status === 'ok' ? 'No big bundle at launch' : f.status === 'unknown' ? 'Bundle check not done yet' : `Bundled launch: ${f.detail}`,
  top10: f => f.status === 'unknown' ? 'Holders not checked yet' : `Top 10 wallets own ${f.detail.split(' ')[0]}`,
  top1: f => `Biggest wallet owns ${f.detail.split(' ')[0]}`,
  insiders: () => 'Several top wallets are linked to each other',
  liq: f => f.status === 'ok' ? 'Enough liquidity to sell' : `Low liquidity: ${f.detail}`,
  lp: f => f.status === 'ok' ? 'Liquidity cannot be pulled' : 'Liquidity is NOT locked, it can be pulled',
  devage: f => f.status === 'unknown' ? 'Dev wallet not checked yet' : f.status === 'ok' ? `Dev wallet is not new (${f.detail.split(',')[0]})` : `Dev wallet is brand new (${f.detail.split(',')[0]})`,
  serial: f => `Dev has launched ${f.detail.split(' ')[0]} other coins before`,
  devhold: f => f.status === 'ok' ? `Dev holds only ${f.detail}` : `Dev still holds ${f.detail}`,
  devsold: () => 'Dev already sold their coins',
  snipers: f => f.status === 'ok' ? 'Few bots at launch' : `Bots bought ${f.detail.match(/[\d.]+%/)?.[0] ?? 'a lot'} in the first seconds`,
  rcinsider: () => 'RugCheck found a network of insider wallets',
  token2022: f => `Token trick: ${f.detail}`,
  washvol: f => `Fake-looking volume: ${f.detail}`,
  dump: () => 'Many more sellers than buyers right now',
  crash: f => `Price crashed ${f.detail}`,
  holders: f => `Very few holders (${f.detail})`,
  rcdanger: f => `RugCheck warnings: ${f.detail}`,
};

let detailTimer;
function select(mint) {
  if (!mint) return;
  selected = mint;
  clearInterval(detailTimer);
  $('#detailBody').innerHTML = '<div class="empty">loading…</div>';
  if (!$('#coinDlg').open) $('#coinDlg').showModal();
  loadDetail();
  detailTimer = setInterval(loadDetail, 1500);
}
$('#coinDlg').addEventListener('close', () => clearInterval(detailTimer));
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
async function loadDetail() {
  if (!selected || !$('#coinDlg').open) return;
  const r = await fetch(`/api/coin/${selected}`).catch(() => null);
  if (r?.ok) renderDetail(await r.json());
}

function renderDetail(c) {
  const m = c.market ?? {}, risk = c.risk ?? { factors: [] }, mom = c.momentum ?? { reasons: [] }, s = c.socials ?? {}, j = c.jup && !c.jup.missing ? c.jup : null;
  const holders = c.rug?.holders?.length ? c.rug.holders : c.chain?.holders ?? [];
  const mint = esc(c.mint);
  const icons = { bad: '✖', warn: '▲', ok: '✔', unknown: '?' };
  const body = $('#detailBody');
  const scrollTop = body.parentElement.scrollTop;
  const openDetails = body.querySelector('details')?.open;
  const order = { bad: 0, warn: 1, unknown: 2, ok: 3 };
  const lines = risk.factors.filter(f => PLAIN[f.key]).sort((a, b) => order[a.status] - order[b.status]);
  const img = c.image ?? m.image ?? c.info?.image ?? j?.icon;
  const sym = encodeURIComponent('$' + (c.symbol ?? ''));
  body.innerHTML = `
    ${c.demo ? '<div class="demoBanner">DEMO DATA: THIS COIN IS FAKE</div>' : ''}
    <div class="dh">${coinImg({ ...c, image: img })}<div><h2>$${esc(c.symbol)} <span class="dim">${esc(c.name)}</span></h2>
      <div class="dim">${esc(c.pump && !c.pump.graduated ? 'still on pump.fun curve' : m.dexId ?? '')} · ${age(c.createdAt ?? m.pairCreatedAt ?? c.firstSeen)} old${c.gtRank ? ` · <span class="trTag">#${c.gtRank} TRENDING</span>` : ''}${c.newsMatch ? ` · <span class="newsTag">${esc(c.newsMatch.author ?? 'NEWS')}: ${esc(c.newsMatch.keyword)}</span>` : ''}</div></div></div>
    ${c.info?.description || c.description ? `<div class="desc">${esc(c.info?.description ?? c.description)}</div>` : ''}
    <div class="ca"><code>${mint}</code><button class="btn" id="copyCa">COPY ADDRESS</button></div>
    <div class="links">
      ${s.twitter ? `<a class="x" href="${safeUrl(s.twitter)}" target="_blank" rel="noopener nofollow">𝕏 TWITTER</a>` : '<a class="missing">no twitter</a>'}
      ${s.telegram ? `<a href="${safeUrl(s.telegram)}" target="_blank" rel="noopener nofollow">TELEGRAM</a>` : ''}
      ${s.website ? `<a href="${safeUrl(s.website)}" target="_blank" rel="noopener nofollow">WEBSITE</a>` : ''}
      ${c.newsMatch?.url ? `<a href="${safeUrl(c.newsMatch.url)}" target="_blank" rel="noopener nofollow">THE POST</a>` : ''}
      <a href="https://x.com/search?q=${sym}&f=live" target="_blank" rel="noopener">SEARCH X</a>
      <a href="https://pump.fun/coin/${mint}" target="_blank" rel="noopener">PUMP.FUN</a>
      <a href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">CHART</a>
      <a href="https://rugcheck.xyz/tokens/${mint}" target="_blank" rel="noopener">RUGCHECK</a>
      <a href="https://bubblemaps.io/sol/token/${mint}" target="_blank" rel="noopener">BUBBLEMAPS</a>
      <a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">SOLSCAN</a>
    </div>
    <div class="big">
      <div class="meter"><div class="lbl">RUG RISK</div><div class="val">${riskBadge(risk.score, risk.grade)}</div><div class="dim">${risk.coverage < 80 ? 'still checking, treat as riskier' : `${risk.coverage}% of checks done`}</div></div>
      <div class="meter"><div class="lbl">HYPE (activity)</div><div class="val" style="color:var(--cyan)">${mom.score ?? 0}</div></div>
      <div class="meter"><div class="lbl">POTENTIAL (not a promise)</div><div class="val pot">${c.pot ?? '–'}</div><div class="dim">${c.pot == null ? 'too risky or not checked yet' : 'fewer red flags + strong activity'}</div></div>
    </div>
    <div class="verdict"><div class="dim" style="font-size:10px;letter-spacing:1px">WHAT WE FOUND</div>
      ${lines.map(f => `<div class="line st-${f.status}">${icons[f.status]} ${esc(PLAIN[f.key](f))}</div>`).join('')}
    </div>
    <div class="verdict"><div class="dim" style="font-size:10px;letter-spacing:1px">WHY IT'S MOVING</div>
      ${mom.reasons.length ? mom.reasons.map(r => `<div class="line">› ${esc(r)}</div>`).join('') : '<div class="line dim">quiet right now</div>'}
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">MCAP</div>$${num(m.mcap ?? c.info?.usdMcap)}</div>
      <div class="stat"><div class="lbl">LIQUIDITY</div>$${num(m.liqUsd)}</div>
      <div class="stat"><div class="lbl">VOL 5M / 1H</div>$${num(m.vol5m)} / $${num(m.vol1h)}</div>
      <div class="stat"><div class="lbl">5M / 1H</div>${pct(m.change5m)} ${pct(m.change1h)}</div>
      <div class="stat"><div class="lbl">BUYS / SELLS 5M</div><span class="up">${m.buys5m ?? '–'}</span> / <span class="down">${m.sells5m ?? '–'}</span></div>
      <div class="stat"><div class="lbl">HOLDERS</div>${c.rug?.totalHolders ?? j?.holders ?? '…'}</div>
      <div class="stat"><div class="lbl">ORGANIC SCORE</div>${j?.organicScore != null ? Math.round(j.organicScore) + '/100' : '–'}</div>
      <div class="stat"><div class="lbl">BUNDLED AT LAUNCH</div>${c.bundle ? `${c.bundle.pct.toFixed(1)}% · ${c.bundle.wallets} wallets` : '–'}</div>
    </div>
    <details ${openDetails ? 'open' : ''}><summary>MORE DETAIL</summary>
      <h3>SCORE BREAKDOWN</h3>
      ${risk.factors.map(f => `<div class="factor"><span class="st-${f.status}">${icons[f.status]}</span><span>${esc(f.label)}</span><span class="st-${f.status}">+${f.points}</span><span class="d">${esc(f.detail)}</span></div>`).join('')}
      <h3>TOP HOLDERS (pool excluded)</h3>
      ${holders.length ? holders.slice(0, 10).map(h => `<div class="hbar"><a href="https://solscan.io/account/${esc(h.address)}" target="_blank" rel="noopener">${esc(short(h.address))}</a><span class="t"><i class="${h.insider ? 'ins' : ''}" style="width:${Math.min(100, h.pct * 4)}%"></i></span><span>${h.pct.toFixed(2)}%${h.insider ? ' <span class="st-bad">LINKED</span>' : ''}</span></div>`).join('') : '<div class="dim">checking…</div>'}
    </details>
    <div class="note">Scores come from free public data that can be wrong, late or faked. LOW risk means fewer red flags were found, never that a coin is safe. Potential is not a promise it goes up.</div>`;
  body.parentElement.scrollTop = scrollTop;
  $('#copyCa').onclick = () => { navigator.clipboard.writeText(c.mint); $('#copyCa').textContent = 'COPIED'; };
}

// ---------- My trades ----------
let tradesTimer, seenSells = null;
async function loadTrades() {
  clearTimeout(tradesTimer);
  const r = await fetch('/api/trades').catch(() => null);
  if (r?.ok) renderTrades(await r.json());
  tradesTimer = setTimeout(loadTrades, 5_000);
}
loadTrades(); // also runs in the background so a winning sell shows its receipt on any tab

function renderTrades(w) {
  const sells = (w.trades ?? []).filter(t => t.side === 'sell' && t.pnl > 0);
  if (seenSells === null) seenSells = new Set(sells.map(t => t.sig));
  else for (const t of sells) if (!seenSells.has(t.sig)) { seenSells.add(t.sig); showReceipt(t, w); break; }
  if (view !== 'trades') return;
  const body = $('#tradesBody');
  if (!w.address) {
    body.innerHTML = `<div class="setup"><b>Add your wallet ADDRESS in ⚙ SETTINGS to see your trades here.</b><br><br>Only the public address (the one you'd share to receive SOL). The app reads your trades from the blockchain. It can't move anything and never trades.<br><span class="keywarn" style="display:inline-block;margin-top:10px">Never paste a private key or seed phrase. Anyone who asks for one is stealing.</span></div>`;
    return;
  }
  const t = w.totals ?? { realized: 0, unrealized: 0, wins: 0, losses: 0 };
  const usd = v => w.solUsd ? `<span class="dim">≈ $${num(v * w.solUsd)}</span>` : '';
  body.innerHTML = `
    ${w.demo ? '<div class="demoBanner">DEMO: FAKE TRADES</div>' : ''}
    <div class="dim" style="margin-bottom:8px">wallet ${esc(short(w.address))} · ${w.checkedAt ? `checked ${age(w.checkedAt)} ago` : 'reading your history…'} ${w.error ? `· <span class="down">${esc(w.error)}</span>` : ''}</div>
    <div class="tsum">
      <div><i>PROFIT TAKEN</i><b>${sol(t.realized)}</b><br>${usd(t.realized)}</div>
      <div><i>OPEN (NOT SOLD YET)</i><b>${sol(t.unrealized)}</b><br>${usd(t.unrealized)}</div>
      <div><i>WINNING SELLS</i><b class="up">${t.wins}</b></div>
      <div><i>LOSING SELLS</i><b class="down">${t.losses}</b></div>
    </div>
    <h3>COINS</h3>
    <table class="tlist"><thead><tr><th>COIN</th><th class="num">SPENT</th><th class="num">GOT BACK</th><th class="num">PROFIT TAKEN</th><th class="num">STILL HOLDING (value)</th><th class="num">OPEN P/L</th><th>LAST</th></tr></thead><tbody>
      ${(w.positions ?? []).map(p => `<tr><td><b>$${esc(p.symbol ?? short(p.mint))}</b> <a href="https://dexscreener.com/solana/${esc(p.mint)}" target="_blank" rel="noopener">chart</a></td>
        <td class="num">${p.spent.toFixed(3)}</td><td class="num">${p.received.toFixed(3)}</td><td class="num">${sol(p.realized)}</td>
        <td class="num">${p.held ? (p.value != null ? p.value.toFixed(3) + ' SOL' : '…') : '<span class="dim">sold</span>'}</td><td class="num">${p.held ? sol(p.unrealized) : ''}</td><td class="dim">${age(p.last)} ago</td></tr>`).join('') || '<tr><td colspan="7" class="dim">no swaps found yet</td></tr>'}
    </tbody></table>
    <h3>TRADES</h3>
    <table class="tlist"><thead><tr><th>WHEN</th><th>SIDE</th><th>COIN</th><th class="num">SOL</th><th class="num">PROFIT</th><th></th></tr></thead><tbody>
      ${(w.trades ?? []).slice(0, 100).map(x => `<tr><td class="dim">${age(x.time)} ago</td><td class="side-${x.side}">${x.side.toUpperCase()}</td><td>$${esc(x.symbol ?? short(x.mint))}</td>
        <td class="num">${x.sol.toFixed(3)}</td><td class="num">${x.side === 'sell' ? (x.pnl == null ? '<span class="dim">bought earlier</span>' : `${sol(x.pnl)} ${pct(x.pnlPct, 0)}`) : ''}</td>
        <td>${x.pnl > 0 ? `<button class="btn" data-r="${esc(x.sig)}">RECEIPT</button>` : ''} ${w.demo ? '' : `<a href="https://solscan.io/tx/${esc(x.sig)}" target="_blank" rel="noopener">tx</a>`}</td></tr>`).join('')}
    </tbody></table>
    <div class="note">Profit uses your average buy price per coin from the history the RPC returns (your latest ~150 transactions). Swap fees and priority fees are included because they come out of your SOL. Transfers and airdrops are not trades and are skipped.</div>`;
  body.querySelectorAll('[data-r]').forEach(b => b.onclick = () => showReceipt(w.trades.find(x => x.sig === b.dataset.r), w));
}

// LARP profit receipt: a printer spits out the receipt, a stamp slams down, coins rain.
function showReceipt(t, w) {
  if (!t) return;
  const el = $('#receipt');
  const now = new Date(t.time || Date.now());
  const usd = w.solUsd ? ` ≈ $${(t.pnl * w.solUsd).toFixed(2)}` : '';
  el.innerHTML = `<div class="printer"><div class="slot"></div>
    <div class="paper">
      <h4>RUGRADAR</h4><div class="c">TERMINAL #0001 · TRADE RECEIPT</div><div class="c">${now.toISOString().replace('T', ' ').slice(0, 19)} UTC</div>
      <hr>
      <div class="row"><span>COIN</span><b>$${esc(t.symbol ?? short(t.mint))}</b></div>
      <div class="row"><span>SOLD FOR</span><span>${t.sol.toFixed(4)} SOL</span></div>
      <div class="row"><span>COST</span><span>${(t.sol - t.pnl).toFixed(4)} SOL</span></div>
      <hr>
      <div class="c">PROFIT</div>
      <div class="tot">+${t.pnl.toFixed(4)} SOL</div>
      <div class="totp">${t.pnlPct != null ? `+${t.pnlPct.toFixed(0)}%` : ''}${esc(usd)}</div>
      <hr>
      <div class="c">${w.demo ? 'DEMO RECEIPT · NOT A REAL TRADE' : `TX ${esc(short(t.sig))}`}</div>
      <div class="bars"></div>
    </div>
    <div class="stamp">PROFIT SECURED</div>
    <div class="bye">click anywhere to close</div></div>`;
  el.hidden = false;
  for (let i = 0; i < 40; i++) {
    const s = document.createElement('span'); s.className = 'coinrain'; s.textContent = ['◎', '$', '◎', '▲'][i % 4];
    s.style.left = Math.random() * 100 + 'vw'; s.style.color = i % 2 ? 'var(--green)' : 'var(--magenta)';
    s.style.animationDuration = 2 + Math.random() * 2.5 + 's'; s.style.animationDelay = 1.8 + Math.random() * 1.2 + 's';
    el.appendChild(s);
  }
  if ($('#sound').checked) chaChing();
  el.onclick = () => { el.hidden = true; el.innerHTML = ''; };
}
function chaChing() {
  try {
    const ctx = audio();
    const t0 = ctx.currentTime;
    for (let i = 0; i < 16; i++) { // printer chatter
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 180 + Math.random() * 60; g.gain.value = 0.04;
      o.connect(g).connect(ctx.destination); o.start(t0 + i * 0.09); o.stop(t0 + i * 0.09 + 0.04);
    }
    [[1568, 1.75], [2093, 1.85], [2637, 1.95]].forEach(([f, d]) => { // the bell
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.25, t0 + d); g.gain.exponentialRampToValueAtTime(0.001, t0 + d + 1.2);
      o.connect(g).connect(ctx.destination); o.start(t0 + d); o.stop(t0 + d + 1.2);
    });
  } catch {}
}

// ---------- Settings ----------
async function openSettings() {
  const s = await (await fetch('/api/settings')).json();
  const f = $('#settingsForm');
  for (const [k, v] of Object.entries(s)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'password') { input.value = ''; const st = f.querySelector(`.state[data-for="${k}"]`); if (st) st.textContent = v ? '✔ saved' : ''; }
    else input.value = v ?? '';
  }
  $('#walletErr').textContent = '';
  $('#settings').showModal();
}
$('#openSettings').addEventListener('click', openSettings);
$('#saveSettings').addEventListener('click', async e => {
  e.preventDefault();
  const form = Object.fromEntries(new FormData($('#settingsForm')));
  const r = await (await post('/api/settings', form)).json();
  if (r.walletError === 'secret') {
    $('#settingsForm').elements.WALLET_ADDRESS.value = '';
    $('#walletErr').textContent = 'STOP: that looks like a PRIVATE KEY or SEED PHRASE. It was NOT saved. Paste only your public address. If you shared it anywhere, move your funds to a new wallet.';
    return;
  }
  if (r.walletError === 'invalid') { $('#walletErr').textContent = 'That is not a Solana address. Copy the address from your wallet app (32-44 letters and numbers).'; return; }
  $('#settings').close();
  seenSells = null;
  loadTrades();
});

// ---------- Chat ----------
$('#openChat').addEventListener('click', () => $('#chatDlg').showModal());
const history = [];
function addMsg(cls, text) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`; d.textContent = text;
  $('#chatLog').appendChild(d); $('#chatLog').scrollTop = 1e9;
  return d;
}
addMsg('sys', 'analyst online. ask about any coin. i explain the risk, i never tell you to buy or sell.');
$('#chatForm').addEventListener('submit', async e => {
  e.preventDefault();
  const q = $('#chatInput').value.trim();
  if (!q) return;
  $('#chatInput').value = '';
  addMsg('u', q);
  history.push({ role: 'user', content: q });
  const out = addMsg('a', '');
  let text = '';
  try {
    const r = await fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', 'x-rugradar': '1' }, body: JSON.stringify({ messages: history, focus: selected ? [selected] : [] }) });
    const reader = r.body.getReader(), dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
      out.textContent = text; $('#chatLog').scrollTop = 1e9;
    }
  } catch (err) { text += `\n[error: ${err.message}]`; out.textContent = text; }
  history.push({ role: 'assistant', content: text || '(no answer)' });
});
