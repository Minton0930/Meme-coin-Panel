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
const age = t => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? `${s | 0}s` : s < 3600 ? `${(s / 60) | 0}m` : s < 86400 ? `${(s / 3600).toFixed(1)}h` : `${(s / 86400).toFixed(1)}d`; };
const short = a => a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
const RISK_WORD = { LOWER: 'LOW', ELEVATED: 'MEDIUM', HIGH: 'HIGH', EXTREME: 'DANGER' };
const riskBadge = (score, grade) => `<span class="badge g-${esc(grade)}">${RISK_WORD[grade] ?? '…'} ${score ?? ''}</span>`;
const post = (url, body, method = 'POST') => fetch(url, { method, headers: { 'content-type': 'application/json', 'x-rugradar': '1' }, body: body ? JSON.stringify(body) : undefined });
const isRisky = c => (c.risk ?? 0) >= 50;
const coinImg = (c, cls = '') => {
  const img = safeUrl(c.image);
  return img ? `<img class="${cls}" src="${img}" alt="${esc((c.symbol ?? '?')[0])}" loading="lazy" referrerpolicy="no-referrer">`
    : `<span class="ph ${cls}">${esc((c.symbol ?? '?')[0])}</span>`;
};
// Swap a coin picture that fails to load for its first letter.
document.addEventListener('error', e => {
  const t = e.target;
  if (t.tagName !== 'IMG' || !t.closest('.tok, .card, .dh')) return;
  const ph = document.createElement('span'); ph.className = `ph ${t.className}`; ph.textContent = t.alt || '?';
  t.replaceWith(ph);
}, true);
// Small link buttons: X, Telegram, website, pump.fun, chart. Missing socials are simply left out.
function linkRow(c) {
  const l = c.links ?? {};
  const m = esc(c.mint);
  return `<span class="lk">
    ${l.twitter ? `<a class="x" href="${safeUrl(l.twitter)}" target="_blank" rel="noopener nofollow" title="X / Twitter">𝕏</a>` : ''}
    ${l.telegram ? `<a href="${safeUrl(l.telegram)}" target="_blank" rel="noopener nofollow" title="Telegram">TG</a>` : ''}
    ${l.website ? `<a href="${safeUrl(l.website)}" target="_blank" rel="noopener nofollow" title="Website">WEB</a>` : ''}
    <a href="https://pump.fun/coin/${m}" target="_blank" rel="noopener" title="pump.fun page">PUMP</a>
    <a href="https://dexscreener.com/solana/${m}" target="_blank" rel="noopener" title="Chart">CHART</a>
  </span>`;
}

let state = { coins: [], alerts: [], watch: [] }, preset = 'potential', sortKey = 'pot', sortDir = -1, selected = null, query = '';
const seen = new Set(), alerted = new Set();
let firstFrame = true;

// ---------- Boot sequence ----------
const bootLines = [
  'RUGRADAR v0.4 // solana memecoin risk terminal',
  '[ok] pump.fun launch stream ......... real time',
  '[ok] dexscreener / jupiter / geckoterminal / rugcheck ... free, no keys',
  '[ok] news radar ..................... headlines + your watch words',
  '[ok] high-risk coins ................ hidden (tick SHOW RISKY to see them)',
  '[!!] analysis only. no buy/sell calls. no keys. no trades.',
  '> access granted_',
];
(async () => {
  const el = $('#bootText');
  for (const l of bootLines) { el.textContent += l + '\n'; await new Promise(r => setTimeout(r, 130)); }
  setTimeout(() => $('#boot').classList.add('gone'), 350);
})();
setInterval(() => { $('#clock').textContent = new Date().toISOString().slice(11, 19) + ' UTC'; }, 250);

// ---------- Live stream ----------
const es = new EventSource('/api/stream');
es.onmessage = ev => {
  state = JSON.parse(ev.data);
  renderTop();
  renderRadar();
  renderHot();
  renderRows();
  checkAlerts();
  renderUpdate();
  firstFrame = false;
};
es.onerror = () => { $('#modeTag').textContent = 'RECONNECTING'; $('#modeTag').className = 'tag'; };

function renderTop() {
  const tag = $('#modeTag');
  tag.textContent = state.demo ? 'DEMO DATA' : 'LIVE';
  tag.className = `tag ${state.demo ? 'demo' : 'live'}`;
  const names = { 'dexscreener-pairs': 'DEX', 'dexscreener-discovery': 'DEX+', pumpportal: 'PUMP', 'pumpfun-info': 'PUMPINFO', jupiter: 'JUP', geckoterminal: 'GECKO', rugcheck: 'RUGCHK', 'solana-rpc': 'RPC', coingecko: 'CG', reddit: 'REDDIT', 'google-news': 'NEWS' };
  $('#sources').innerHTML = state.demo ? '<span class="src warn">FAKE DATA</span>' : Object.entries(state.status).filter(([k]) => names[k]).map(([k, s]) => {
    const bad = s.lastError && (!s.lastOk || s.lastError.at > s.lastOk);
    return `<span class="src ${bad ? 'err' : s.lastOk ? 'ok' : ''}" title="${esc(k)}: ${s.reqPerMin} requests/min${bad ? ' · ' + esc(s.lastError.msg) : ''}">${esc(names[k])}</span>`;
  }).join('');
  const c = state.cadence;
  $('#cadence').textContent = state.demo ? 'DEMO MODE: fake coins and fake posts, nothing here is real' : `screen updates every 1s · launches ${c.newLaunches} · ${c.extra}`;
  $('#chatState').textContent = state.chat ? '' : ' (off: needs a paid Anthropic key in SETTINGS, everything else is free)';
  const hot = state.coins.filter(x => !isRisky(x)).sort((a, b) => (b.mom ?? 0) - (a.mom ?? 0)).slice(0, 14);
  const t = hot.map(x => `<span>$${esc(x.symbol)} ${pct(x.chg5m)}</span>`).join('');
  $('#tickerInner').innerHTML = t + t;
}

function renderUpdate() {
  const bar = $('#updateBar');
  if (state.update?.available) {
    bar.textContent = `NEW VERSION ${state.update.latest} READY: close the black window and double-click start.bat`;
    bar.classList.add('show');
  } else bar.classList.remove('show');
}

// ---------- News radar ----------
const fmtSecs = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
function renderRadar() {
  $('#radarSub').textContent = state.demo ? 'demo posts every ~40s' : `headlines about ${(state.newsTopics ?? []).join(', ') || 'big names'} + your words`;
  const box = $('#alertBox');
  const a = state.alerts[0];
  if (!a) {
    box.className = 'alertbox';
    box.innerHTML = `<div class="dim">Waiting for news… Type a word below (a name from a post you just saw, like "elsa") and any coin launched with that name pops up here the second it appears. Headlines about big names are added automatically.</div>`;
  } else {
    box.className = 'alertbox hit';
    const when = a.secsAfterPost >= 0 ? `${fmtSecs(a.secsAfterPost)} after the post` : `${fmtSecs(-a.secsAfterPost)} BEFORE the post`;
    box.innerHTML = `<span class="bigline">NEWS MATCH: <b>$${esc(a.symbol)}</b> matches "${esc(a.keyword)}" <span class="dim">${age(a.at)} ago · ${esc(when)} · ${a.match === 'exact' ? 'exact name' : 'similar name'}</span></span>
      <div class="post">${esc(a.author ?? (a.source === 'manual' ? 'your watch word' : ''))}: ${a.postUrl ? `<a href="${safeUrl(a.postUrl)}" target="_blank" rel="noopener nofollow">${esc(a.postText)}</a>` : esc(a.postText)}</div>
      ${state.alerts.length > 1 ? `<div class="alertlist">${state.alerts.slice(1, 12).map(x => `<div data-m="${esc(x.mint)}">· $${esc(x.symbol)} ← "${esc(x.keyword)}" <span class="dim">${age(x.at)} ago</span></div>`).join('')}</div>` : ''}
      <div class="dim" style="font-size:10px;margin-top:4px">Many copycat coins launch for every news name and most are dumped within minutes. Check the risk first.</div>`;
    box.querySelector('.bigline').onclick = () => select(a.mint);
    box.querySelectorAll('.alertlist div').forEach(d => d.onclick = () => select(d.dataset.m));
  }
  $('#watchChips').innerHTML = state.watch.slice(0, 24).map(w =>
    `<span class="chip ${w.source}" title="${esc(w.author ?? '')} ${esc(w.text ?? '')}">${w.source === 'manual' ? '' : w.source === 'x' ? 'X·' : 'NEWS·'}${esc(w.kw)}${w.source === 'manual' ? `<button data-kw="${esc(w.kw)}" title="stop watching">×</button>` : ''}</span>`).join('')
    || '<span class="dim">no watch words yet</span>';
}
$('#watchChips').addEventListener('click', e => { const b = e.target.closest('button[data-kw]'); if (b) post(`/api/watch?kw=${encodeURIComponent(b.dataset.kw)}`, null, 'DELETE'); });
$('#watchForm').addEventListener('submit', e => {
  e.preventDefault();
  const w = $('#watchInput').value.trim();
  if (w) post('/api/watch', { word: w });
  $('#watchInput').value = '';
});

// ---------- Top potential cards ----------
function renderHot() {
  const top = state.coins.filter(c => c.pot != null).sort((a, b) => b.pot - a.pot).slice(0, 5);
  $('#hot').innerHTML = top.map(c => `<div class="card" data-m="${esc(c.mint)}">
    <div class="s">${coinImg(c)}<span>$${esc(c.symbol ?? '???')}</span>${c.news ? '<span class="newsTag">NEWS</span>' : ''}</div>
    <div class="r"><span>potential <b class="pot">${c.pot}</b></span>${pct(c.chg5m, 0)}</div>
    <div class="r"><span class="dim">mcap ${num(c.mcap)}</span>${riskBadge(c.risk, c.grade)}</div></div>`).join('')
    || '<span class="dim">nothing passes the filter right now (needs lower risk, checks done and strong activity)</span>';
}
$('#hot').addEventListener('click', e => { const c = e.target.closest('[data-m]'); if (c) select(c.dataset.m); });

// ---------- Coin table ----------
const presets = {
  potential: c => c.pot != null,
  all: () => true,
  new: c => Date.now() - c.createdAt < 10 * 60_000,
  trending: c => !!c.gtRank || (c.mom ?? 0) >= 50,
  news: c => !!c.news,
};
const DEFAULT_SORT = { potential: 'pot', all: 'createdAt', new: 'createdAt', trending: 'mom', news: 'createdAt' };

function renderRows() {
  const showRisky = $('#showRisky').checked;
  const total = state.coins.length;
  let list = state.coins.filter(c => showRisky || !isRisky(c)).filter(presets[preset]);
  const hidden = showRisky ? 0 : state.coins.filter(isRisky).length;
  if (query) list = list.filter(c => (c.symbol ?? '').toLowerCase().includes(query) || (c.name ?? '').toLowerCase().includes(query) || c.mint.toLowerCase().includes(query));
  list.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
  });
  list = list.slice(0, 250);
  $('#count').textContent = `[${list.length} shown · ${hidden} risky hidden · ${total} tracked]`;
  $('#emptyMsg').textContent = list.length ? '' : preset === 'potential'
    ? 'No coin passes the HIGH POTENTIAL filter right now. It needs LOW or MEDIUM risk, most checks done, and strong activity. Try ALL or TRENDING.'
    : 'Nothing here right now.';
  $('#rows').innerHTML = list.map(c => {
    const fresh = !seen.has(c.mint); seen.add(c.mint);
    return `<tr data-m="${esc(c.mint)}" class="${c.mint === selected ? 'sel' : ''} ${fresh && !firstFrame ? 'fresh' : ''}">
      <td><div class="tok">${coinImg(c)}<div><div class="t1"><b>$${esc(c.symbol ?? '???')}</b><span class="nm">${esc(c.name)}</span>${c.news ? '<span class="newsTag">NEWS</span>' : ''}${c.gtRank ? `<span class="trTag" title="GeckoTerminal trending">#${c.gtRank}</span>` : ''}</div>${linkRow(c)}</div></div></td>
      <td class="num dim">${age(c.createdAt)}</td>
      <td class="num">${num(c.mcap)}</td>
      <td class="num">${c.stage === 'curve' ? '<span class="dim" title="still on the pump.fun curve">curve</span>' : num(c.liq)}</td>
      <td class="num">${num(c.vol5m)}</td>
      <td class="num">${pct(c.chg5m)}</td>
      <td class="num">${c.holders ?? '<span class="dim">…</span>'}</td>
      <td class="num ${c.top10 > 35 ? 'down' : ''}">${c.top10 == null ? '<span class="dim">…</span>' : c.top10.toFixed(0) + '%'}</td>
      <td title="${esc(c.flag ? 'Worst flag: ' + c.flag : '')}">${riskBadge(c.risk, c.grade)}${c.coverage < 80 ? ' <span class="cov">checking</span>' : ''}</td>
      <td><span class="bar"><i style="width:${Math.max(0, Math.min(100, c.mom ?? 0))}%"></i></span>${c.mom ?? 0}</td>
      <td class="num">${c.pot != null ? `<span class="pot">${c.pot}</span>` : '<span class="dim">–</span>'}</td>
    </tr>`;
  }).join('');
}

$('#rows').addEventListener('click', e => {
  if (e.target.closest('a')) return; // link buttons open their page, they don't select the row
  const tr = e.target.closest('tr[data-m]'); if (tr) select(tr.dataset.m);
});
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  preset = b.dataset.p;
  sortKey = DEFAULT_SORT[preset]; sortDir = -1;
  document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('on', x === b));
  renderRows();
});
document.querySelectorAll('th[data-k]').forEach(th => th.addEventListener('click', () => {
  const k = th.dataset.k;
  sortDir = sortKey === k ? -sortDir : -1; sortKey = k;
  document.querySelectorAll('th').forEach(x => x.classList.toggle('sorted', x === th));
  renderRows();
}));
$('#search').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); renderRows(); });
$('#showRisky').addEventListener('change', renderRows);

// ---------- Sound + notifications ----------
$('#alerts').addEventListener('change', e => { if (e.target.checked && 'Notification' in window) Notification.requestPermission(); });
document.addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }, { once: true });
function checkAlerts() {
  const fresh = [];
  for (const a of state.alerts) if (!alerted.has('n' + a.id)) { alerted.add('n' + a.id); if (!firstFrame && Date.now() - a.at < 30_000) fresh.push(a); }
  for (const c of state.coins.filter(c => c.pot != null && c.pot >= 70)) if (!alerted.has('p' + c.mint)) { alerted.add('p' + c.mint); if (!firstFrame) fresh.push({ pot: c }); }
  if (!fresh.length || !$('#alerts').checked) return;
  const news = fresh.find(f => f.keyword);
  beep(news ? 3 : 1);
  if (news) { $('#alertBox').classList.remove('flash'); void $('#alertBox').offsetWidth; $('#alertBox').classList.add('flash'); }
  if (window.Notification?.permission === 'granted') {
    if (news) new Notification(`NEWS MATCH: $${news.symbol}`, { body: `matches "${news.keyword}". Check the risk before doing anything.` });
    else new Notification(`$${fresh[0].pot.symbol}: potential ${fresh[0].pot.pot}`, { body: `risk ${fresh[0].pot.risk} · hype ${fresh[0].pot.mom}. Check it yourself first.` });
  }
}
let actx;
function beep(times = 1) {
  try {
    actx ??= new AudioContext();
    for (let i = 0; i < times; i++) {
      const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime + i * 0.18;
      o.type = 'square'; o.frequency.value = times > 1 ? 1320 : 880; g.gain.value = 0.05;
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t + 0.12);
    }
  } catch {}
}

// ---------- Coin check (detail) ----------
const PLAIN = {
  rugged: () => 'Already marked as RUGGED',
  mint: f => f.status === 'ok' ? 'Dev cannot create more coins' : f.status === 'unknown' ? 'Mint authority not checked yet' : 'Dev can still create more coins (can dilute you)',
  freeze: f => f.status === 'ok' ? 'Dev cannot freeze your coins' : f.status === 'unknown' ? 'Freeze authority not checked yet' : 'Dev can freeze wallets so you cannot sell',
  top10: f => f.status === 'unknown' ? 'Holders not checked yet' : `Top 10 wallets own ${f.detail.split(' ')[0]}`,
  top1: f => `Biggest wallet owns ${f.detail.split(' ')[0]}`,
  insiders: () => 'Several top wallets are linked to each other',
  liq: f => f.status === 'ok' ? 'Enough liquidity to sell' : `Low liquidity: ${f.detail}`,
  lp: f => f.status === 'ok' ? 'Liquidity cannot be pulled' : 'Liquidity is NOT locked, it can be pulled',
  devage: f => f.status === 'unknown' ? 'Dev wallet not checked yet' : f.status === 'ok' ? `Dev wallet is not new (${f.detail.split(',')[0]})` : `Dev wallet is brand new (${f.detail.split(',')[0]})`,
  serial: f => `Dev has launched ${f.detail.split(' ')[0]} other coins before`,
  devhold: f => f.status === 'ok' ? `Dev holds only ${f.detail}` : `Dev still holds ${f.detail}`,
  devsold: () => 'Dev already sold their coins',
  snipers: f => f.status === 'ok' ? 'Few bots at launch' : `Bots bought ${f.detail.match(/[\d.]+%/)?.[0] ?? 'a lot'} in the first 5 seconds`,
  rcinsider: () => 'RugCheck found a network of insider wallets',
  dump: () => 'Many more sellers than buyers right now',
  crash: f => `Price crashed ${f.detail}`,
  holders: f => `Very few holders (${f.detail})`,
  rcdanger: f => `RugCheck warnings: ${f.detail}`,
};

let detailTimer;
function select(mint) {
  if (!mint) return;
  selected = mint;
  renderRows();
  clearInterval(detailTimer);
  loadDetail();
  detailTimer = setInterval(loadDetail, 1000);
}
async function loadDetail() {
  if (!selected) return;
  const r = await fetch(`/api/coin/${selected}`).catch(() => null);
  if (r?.ok) renderDetail(await r.json());
}

function renderDetail(c) {
  const m = c.market ?? {}, risk = c.risk ?? { factors: [] }, mom = c.momentum ?? { reasons: [] }, s = c.socials ?? {}, j = c.jup && !c.jup.missing ? c.jup : null;
  const holders = c.rug?.holders?.length ? c.rug.holders : c.chain?.holders ?? [];
  const mint = esc(c.mint);
  const icons = { bad: '✖', warn: '▲', ok: '✔', unknown: '?' };
  const scrollTop = $('#detailBody').scrollTop;
  const openDetails = $('#detailBody details')?.open;
  const order = { bad: 0, warn: 1, unknown: 2, ok: 3 };
  const lines = risk.factors.filter(f => PLAIN[f.key]).sort((a, b) => order[a.status] - order[b.status]);
  const img = c.image ?? m.image ?? c.info?.image ?? j?.icon;
  const sym = encodeURIComponent('$' + (c.symbol ?? ''));
  $('#detailBody').innerHTML = `
    ${c.demo ? '<div class="demoBanner">DEMO DATA: THIS COIN IS FAKE</div>' : ''}
    <div class="dh">${coinImg({ ...c, image: img })}<div><h2>$${esc(c.symbol)} <span class="dim">${esc(c.name)}</span></h2>
      <div class="dim">${esc(c.pump && !c.pump.graduated ? 'still on pump.fun curve' : m.dexId ?? '')} · ${age(c.createdAt ?? m.pairCreatedAt ?? c.firstSeen)} old${c.gtRank ? ` · <span class="trTag">#${c.gtRank} TRENDING</span>` : ''}${c.newsMatch ? ` · <span class="newsTag">NEWS: ${esc(c.newsMatch.keyword)}</span>` : ''}</div></div></div>
    ${c.info?.description || c.description ? `<div class="desc">${esc(c.info?.description ?? c.description)}</div>` : ''}
    <div class="ca"><code>${mint}</code><button class="btn" id="copyCa">COPY ADDRESS</button></div>
    <div class="links">
      ${s.twitter ? `<a class="x" href="${safeUrl(s.twitter)}" target="_blank" rel="noopener nofollow">𝕏 TWITTER</a>` : '<a class="missing">no twitter</a>'}
      ${s.telegram ? `<a href="${safeUrl(s.telegram)}" target="_blank" rel="noopener nofollow">TELEGRAM</a>` : ''}
      ${s.website ? `<a href="${safeUrl(s.website)}" target="_blank" rel="noopener nofollow">WEBSITE</a>` : ''}
      <a href="https://x.com/search?q=${sym}&f=live" target="_blank" rel="noopener">SEARCH X FOR $${esc(c.symbol)}</a>
      <a href="https://pump.fun/coin/${mint}" target="_blank" rel="noopener">PUMP.FUN</a>
      <a href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">CHART</a>
      <a href="https://jup.ag/tokens/${mint}" target="_blank" rel="noopener">JUPITER</a>
      <a href="https://rugcheck.xyz/tokens/${mint}" target="_blank" rel="noopener">RUGCHECK</a>
      <a href="https://bubblemaps.io/sol/token/${mint}" target="_blank" rel="noopener">BUBBLEMAPS</a>
      <a href="https://solscan.io/token/${mint}" target="_blank" rel="noopener">SOLSCAN</a>
    </div>
    <div class="big">
      <div class="meter"><div class="lbl">RUG RISK</div><div class="val">${riskBadge(risk.score, risk.grade)}</div><div class="dim">${risk.coverage < 80 ? 'still checking, treat as riskier' : `${risk.coverage}% of checks done`}</div></div>
      <div class="meter"><div class="lbl">HYPE (activity)</div><div class="val" style="color:var(--cyan)">${mom.score ?? 0}</div></div>
      <div class="meter"><div class="lbl">POTENTIAL (filter, not a forecast)</div><div class="val pot">${c.pot ?? '–'}</div><div class="dim">${c.pot == null ? 'too risky or not checked yet' : 'lower risk + strong activity'}</div></div>
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
      <div class="stat"><div class="lbl">PUMP COMMENTS</div>${c.info?.replies ?? '–'}</div>
    </div>
    <details ${openDetails ? 'open' : ''}><summary>MORE DETAIL</summary>
      <h3>SCORE BREAKDOWN</h3>
      ${risk.factors.map(f => `<div class="factor"><span class="st-${f.status}">${icons[f.status]}</span><span>${esc(f.label)}</span><span class="st-${f.status}">+${f.points}</span><span class="d">${esc(f.detail)}</span></div>`).join('')}
      <h3>TOP HOLDERS (pool excluded)</h3>
      ${holders.length ? holders.slice(0, 10).map(h => `<div class="hbar"><a href="https://solscan.io/account/${esc(h.address)}" target="_blank" rel="noopener">${esc(short(h.address))}</a><span class="t"><i class="${h.insider ? 'ins' : ''}" style="width:${Math.min(100, h.pct * 4)}%"></i></span><span>${h.pct.toFixed(2)}%${h.insider ? ' <span class="st-bad">LINKED</span>' : ''}</span></div>`).join('') : '<div class="dim">checking…</div>'}
    </details>
    <div class="note">Scores come from free public data that can be wrong, late or faked. LOW risk means fewer red flags were found, never that a coin is safe.</div>`;
  $('#detailBody').scrollTop = scrollTop;
  $('#copyCa').onclick = () => { navigator.clipboard.writeText(c.mint); $('#copyCa').textContent = 'COPIED'; };
}

// ---------- Settings ----------
async function openSettings() {
  const s = await (await fetch('/api/settings')).json();
  const f = $('#settingsForm');
  for (const [k, v] of Object.entries(s)) {
    const input = f.elements[k];
    if (!input) continue;
    if (input.type === 'password') { input.value = ''; const st = f.querySelector(`.state[data-for="${k}"]`); if (st) st.textContent = v ? '✔ saved' : ''; }
    else input.value = v;
  }
  $('#settings').showModal();
}
$('#openSettings').addEventListener('click', openSettings);
$('#saveSettings').addEventListener('click', async e => {
  e.preventDefault();
  await post('/api/settings', Object.fromEntries(new FormData($('#settingsForm'))));
  $('#settings').close();
});

// ---------- Chat ----------
const history = [];
function addMsg(cls, text) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`; d.textContent = text;
  $('#chatLog').appendChild(d); $('#chatLog').scrollTop = 1e9;
  return d;
}
addMsg('sys', 'analyst online. ask about any coin on screen. i explain the risk, i never tell you to buy or sell.');
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
