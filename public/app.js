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

let state = { coins: [], alerts: [], watch: [] }, preset = 'all', sortKey = 'createdAt', sortDir = -1, selected = null, query = '';
const seen = new Set(), alerted = new Set();
let firstFrame = true;

// ---------- Boot sequence ----------
const bootLines = [
  'RugRadar',
  'warming up the rug checks, news radar and hype radar',
  'analysis only · never buys, never sells, never asks for keys',
];
(async () => {
  const el = $('#bootText');
  for (const l of bootLines) { el.textContent += l + '\n'; await new Promise(r => setTimeout(r, 130)); }
  setTimeout(() => $('#boot').classList.add('gone'), 350);
})();
setInterval(() => {
  const d = new Date();
  $('#clock').innerHTML = `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}<small>${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}</small>`;
}, 1000);

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
  const names = { 'dexscreener-pairs': 'DEX', 'dexscreener-discovery': 'DEX+', pumpportal: 'PUMP', rugcheck: 'RUGCHK', 'solana-rpc': 'RPC', coingecko: 'CG', reddit: 'REDDIT', 'tiktok-apify': 'TIKTOK', 'x-api': 'X', 'google-news': 'NEWS' };
  $('#sources').innerHTML = state.demo ? '<span class="src warn">FAKE DATA</span>' : Object.entries(state.status).map(([k, s]) => {
    const bad = s.lastError && (!s.lastOk || s.lastError.at > s.lastOk);
    return `<span class="src ${bad ? 'err' : s.lastOk ? 'ok' : ''}" title="${esc(k)}: ${s.reqPerMin} requests/min${bad ? ' · ' + esc(s.lastError.msg) : ''}">${esc(names[k] ?? k)}</span>`;
  }).join('');
  const c = state.cadence;
  $('#cadence').textContent = state.demo ? 'DEMO MODE: fake coins and fake posts, nothing here is real' : `screen updates every 1s · new launches ${c.newLaunches} · ${c.news}`;
  $('#chatState').textContent = state.chat ? '' : ' (off: add your Anthropic key in SETTINGS)';
  const hot = [...state.coins].sort((a, b) => (b.mom ?? 0) - (a.mom ?? 0)).slice(0, 14);
  const t = hot.map(x => `<span>$${esc(x.symbol)} ${pct(x.chg5m)}</span>`).join('');
  $('#tickerInner').innerHTML = t + t;
}

function renderUpdate() {
  const bar = $('#updateBar');
  if (state.update?.available) {
    bar.textContent = `New version ${state.update.latest} is ready: close the black window and double-click start.bat to get it`;
    bar.classList.add('show');
  } else bar.classList.remove('show');
}

// ---------- News radar ----------
function renderRadar() {
  $('#radarSub').textContent = state.x
    ? `watching X: ${state.xAccounts.slice(0, 4).map(a => '@' + a).join(' ')}${state.xAccounts.length > 4 ? ' +' + (state.xAccounts.length - 4) : ''}`
    : state.demo ? 'demo posts every ~40s' : 'X posts off (needs X key) · headlines + your words on';
  const box = $('#alertBox');
  const a = state.alerts[0];
  if (!a) {
    box.className = 'alertbox';
    box.innerHTML = `<div class="dim">Waiting for news… When a watched account posts a name (like a new dog called Elsa) or you add a word below, any coin launched with that name shows up here the second it appears.</div>`;
  } else {
    box.className = 'alertbox hit';
    const when = a.secsAfterPost >= 0 ? `${fmtSecs(a.secsAfterPost)} after the post` : `${fmtSecs(-a.secsAfterPost)} BEFORE the post`;
    box.innerHTML = `<span class="big">NEWS MATCH: <b>$${esc(a.symbol)}</b> matches "${esc(a.keyword)}" <span class="dim" style="font-size:11px">${age(a.at)} ago · ${esc(when)} · ${a.match === 'exact' ? 'exact name' : 'similar name'}</span></span>
      <div class="post">${esc(a.author ?? (a.source === 'manual' ? 'your watch word' : ''))}: ${a.postUrl ? `<a href="${safeUrl(a.postUrl)}" target="_blank" rel="noopener nofollow">${esc(a.postText)}</a>` : esc(a.postText)}</div>
      ${state.alerts.length > 1 ? `<div class="alertlist">${state.alerts.slice(1, 12).map(x => `<div data-m="${esc(x.mint)}">· $${esc(x.symbol)} ← "${esc(x.keyword)}" <span class="dim">${age(x.at)} ago</span></div>`).join('')}</div>` : ''}
      <div class="dim" style="font-size:10px;margin-top:4px">Many copycat coins launch for every news name. Most are dumped within minutes. Click one and check its risk first.</div>`;
    box.querySelector('.big').onclick = () => select(a.mint);
    box.querySelectorAll('.alertlist div').forEach(d => d.onclick = () => select(d.dataset.m));
  }
  $('#watchChips').innerHTML = state.watch.slice(0, 24).map(w =>
    `<span class="chip ${w.source}" title="${esc(w.author ?? '')} ${esc(w.text ?? '')}">${w.source === 'manual' ? '' : w.source === 'x' ? 'X·' : 'NEWS·'}${esc(w.kw)}${w.source === 'manual' ? `<button data-kw="${esc(w.kw)}" title="stop watching">×</button>` : ''}</span>`).join('')
    || '<span class="dim">no watch words yet</span>';
}
const fmtSecs = s => s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${(s / 3600).toFixed(1)}h`;
$('#watchChips').addEventListener('click', e => { const b = e.target.closest('button[data-kw]'); if (b) post(`/api/watch?kw=${encodeURIComponent(b.dataset.kw)}`, null, 'DELETE'); });
$('#watchForm').addEventListener('submit', e => {
  e.preventDefault();
  const w = $('#watchInput').value.trim();
  if (w) post('/api/watch', { word: w });
  $('#watchInput').value = '';
});

// ---------- Hot right now ----------
function renderHot() {
  const hot = state.coins.filter(c => c.mom != null).sort((a, b) => (b.mom ?? 0) - (a.mom ?? 0)).slice(0, 5);
  $('#hot').innerHTML = hot.map(c => `<div class="card" data-m="${esc(c.mint)}">
    <div class="s">$${esc(c.symbol ?? '???')}${c.news ? '<span class="newsTag">NEWS</span>' : ''}</div>
    <div class="r"><span>hype <b style="color:var(--cyan)">${c.mom}</b></span>${pct(c.chg5m, 0)}</div>
    <div class="r"><span class="dim">mcap ${num(c.mcap)}</span>${riskBadge(c.risk, c.grade)}</div></div>`).join('') || '<span class="dim">warming up…</span>';
}
$('#hot').addEventListener('click', e => { const c = e.target.closest('[data-m]'); if (c) select(c.dataset.m); });

// ---------- Coin table ----------
const presets = {
  all: () => true,
  new: c => Date.now() - c.createdAt < 10 * 60_000,
  news: c => !!c.news,
  clean: c => c.risk != null && c.risk < 35 && (c.coverage ?? 0) >= 80 && (c.mom ?? 0) >= 45,
  danger: c => (c.risk ?? 0) >= 60,
};

function renderRows() {
  let list = state.coins.filter(presets[preset]);
  if (query) list = list.filter(c => (c.symbol ?? '').toLowerCase().includes(query) || (c.name ?? '').toLowerCase().includes(query) || c.mint.toLowerCase().includes(query));
  list.sort((a, b) => {
    const x = a[sortKey], y = b[sortKey];
    if (x == null) return 1; if (y == null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
  });
  list = list.slice(0, 250);
  $('#count').textContent = `[${list.length}/${state.coins.length}]`;
  $('#rows').innerHTML = list.map(c => {
    const fresh = !seen.has(c.mint); seen.add(c.mint);
    const img = safeUrl(c.image);
    return `<tr data-m="${esc(c.mint)}" class="${c.mint === selected ? 'sel' : ''} ${fresh && !firstFrame ? 'fresh' : ''}">
      <td><div class="tok">${img ? `<img src="${img}" loading="lazy" referrerpolicy="no-referrer">` : '<span class="ph"></span>'}<b>$${esc(c.symbol ?? '???')}</b><span class="nm">${esc(c.name)}</span>${c.news ? '<span class="newsTag">NEWS</span>' : ''}${c.stage === 'curve' ? '' : '<span class="dim" title="left the pump.fun curve">★</span>'}</div></td>
      <td class="num dim">${age(c.createdAt)}</td>
      <td class="num">${num(c.mcap)}</td>
      <td class="num">${num(c.vol5m)}</td>
      <td class="num">${pct(c.chg5m)}</td>
      <td title="${esc(c.flag ? 'Worst flag: ' + c.flag : '')}${c.coverage < 80 ? ' · still checking' : ''}">${riskBadge(c.risk, c.grade)}${c.coverage < 80 ? ' <span class="cov">checking</span>' : ''}</td>
      <td><span class="bar"><i style="width:${Math.max(0, Math.min(100, c.mom ?? 0))}%"></i></span>${c.mom ?? 0}</td>
    </tr>`;
  }).join('');
}

$('#rows').addEventListener('click', e => { const tr = e.target.closest('tr[data-m]'); if (tr) select(tr.dataset.m); });
$('#presets').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  preset = b.dataset.p;
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

// ---------- Sound + notifications ----------
$('#alerts').addEventListener('change', e => { if (e.target.checked && 'Notification' in window) Notification.requestPermission(); });
document.addEventListener('click', () => { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission(); }, { once: true });
function checkAlerts() {
  const fresh = [];
  for (const a of state.alerts) if (!alerted.has('n' + a.id)) { alerted.add('n' + a.id); if (!firstFrame && Date.now() - a.at < 30_000) fresh.push(a); }
  for (const c of state.coins.filter(presets.clean)) if (!alerted.has('c' + c.mint)) { alerted.add('c' + c.mint); if (!firstFrame) fresh.push({ clean: c }); }
  if (!fresh.length || !$('#alerts').checked) return;
  const news = fresh.find(f => f.keyword);
  beep(news ? 3 : 1);
  if (news) { $('#alertBox').classList.remove('flash'); void $('#alertBox').offsetWidth; $('#alertBox').classList.add('flash'); }
  if (window.Notification?.permission === 'granted') {
    if (news) new Notification(`NEWS MATCH: $${news.symbol}`, { body: `matches "${news.keyword}" from ${news.author ?? 'your watch list'}. Check the risk before doing anything.` });
    else new Notification(`$${fresh[0].clean.symbol} is LOW RISK + HOT`, { body: `risk ${fresh[0].clean.risk} · hype ${fresh[0].clean.mom}. Check it yourself first.` });
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
  mint: f => f.status === 'ok' ? 'Dev cannot create more coins' : 'Dev can still create more coins (can dilute you)',
  freeze: f => f.status === 'ok' ? 'Dev cannot freeze your coins' : 'Dev can freeze wallets so you cannot sell',
  top10: f => `Top 10 wallets own ${f.detail.split(' ')[0]}`,
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
  const m = c.market ?? {}, risk = c.risk ?? { factors: [] }, mom = c.momentum ?? { reasons: [] };
  const holders = c.rug?.holders?.length ? c.rug.holders : c.chain?.holders ?? [];
  const img = safeUrl(c.image ?? m.image);
  const mint = esc(c.mint);
  const icons = { bad: '✖', warn: '▲', ok: '✔', unknown: '?' };
  const scrollTop = $('#detailBody').scrollTop;
  const openDetails = $('#detailBody details')?.open;
  const socials = [...(c.links ?? []), ...(m.socials ?? [])].filter(l => safeUrl(l.url));
  const lines = risk.factors.filter(f => PLAIN[f.key]).sort((a, b) => ({ bad: 0, warn: 1, unknown: 2, ok: 3 }[a.status] - { bad: 0, warn: 1, unknown: 2, ok: 3 }[b.status]));
  $('#detailBody').innerHTML = `
    ${c.demo ? '<div class="demoBanner">DEMO DATA: THIS COIN IS FAKE</div>' : ''}
    <div class="dh">${img ? `<img src="${img}" referrerpolicy="no-referrer">` : ''}<div><h2>$${esc(c.symbol)} <span class="dim">${esc(c.name)}</span></h2>
      <div class="dim">${esc(c.pump && !c.pump.graduated ? 'still on pump.fun' : m.dexId ?? '')} · ${age(c.createdAt ?? m.pairCreatedAt ?? c.firstSeen)} old${c.newsMatch ? ` · <span class="newsTag">NEWS: ${esc(c.newsMatch.keyword)}</span>` : ''}</div></div></div>
    <div class="ca"><code>${mint}</code><button class="btn" id="copyCa">COPY ADDRESS</button></div>
    <div class="big">
      <div class="meter"><div class="lbl">RUG RISK</div><div class="val">${riskBadge(risk.score, risk.grade)}</div><div class="dim">${risk.coverage < 80 ? 'still checking, treat as riskier' : `${risk.coverage}% of checks done`}</div></div>
      <div class="meter"><div class="lbl">HYPE (activity, not a prediction)</div><div class="val" style="color:var(--cyan)">${mom.score ?? 0}</div><div class="dim">${esc(mom.reasons.slice(0, 2).join(' · ')) || 'quiet'}</div></div>
    </div>
    <div class="verdict"><div class="lbl dim" style="font-size:10px;letter-spacing:1px">WHAT WE FOUND</div>
      ${lines.map(f => `<div class="line st-${f.status}">${icons[f.status]} ${esc(PLAIN[f.key](f))}</div>`).join('')}
    </div>
    <div class="stats">
      <div class="stat"><div class="lbl">MCAP</div>$${num(m.mcap)}</div>
      <div class="stat"><div class="lbl">LIQUIDITY</div>$${num(m.liqUsd)}</div>
      <div class="stat"><div class="lbl">5M CHANGE</div>${pct(m.change5m)}</div>
      <div class="stat"><div class="lbl">BUYS / SELLS 5M</div><span class="up">${m.buys5m ?? '–'}</span> / <span class="down">${m.sells5m ?? '–'}</span></div>
    </div>
    <div class="links">
      <a href="https://dexscreener.com/solana/${mint}" target="_blank" rel="noopener">chart</a>
      <a href="https://pump.fun/coin/${mint}" target="_blank" rel="noopener">pump.fun</a>
      <a href="https://rugcheck.xyz/tokens/${mint}" target="_blank" rel="noopener">rugcheck</a>
      <a href="https://bubblemaps.io/sol/token/${mint}" target="_blank" rel="noopener">bubblemaps</a>
      ${socials.slice(0, 4).map(l => `<a href="${safeUrl(l.url)}" target="_blank" rel="noopener nofollow">${esc(l.type ?? 'link')}</a>`).join('')}
    </div>
    <details ${openDetails ? 'open' : ''}><summary>MORE DETAIL</summary>
      <h3>SCORE BREAKDOWN</h3>
      ${risk.factors.map(f => `<div class="factor"><span class="st-${f.status}">${icons[f.status]}</span><span>${esc(f.label)}</span><span class="st-${f.status}">+${f.points}</span><span class="d">${esc(f.detail)}</span></div>`).join('')}
      <h3>TOP HOLDERS (pool excluded)</h3>
      ${holders.length ? holders.slice(0, 10).map(h => `<div class="hbar"><a href="https://solscan.io/account/${esc(h.address)}" target="_blank" rel="noopener">${esc(short(h.address))}</a><span class="t"><i class="${h.insider ? 'ins' : ''}" style="width:${Math.min(100, h.pct * 4)}%"></i></span><span>${h.pct.toFixed(2)}%${h.insider ? ' <span class="st-bad">LINKED</span>' : ''}</span></div>`).join('') : '<div class="dim">checking…</div>'}
      <h3>SOCIAL</h3>
      ${c.trend ? `<div>CoinGecko trending: ${c.trend.coingeckoTrending ? '<span class="up">YES</span>' : 'no'}</div>
        <div>Reddit: ${c.trend.reddit ? `${c.trend.reddit.posts1h} posts in the last hour` : 'n/a'}</div>
        <div>TikTok: ${c.trend.tiktokEnabled ? (c.trend.tiktok ? `${c.trend.tiktok.videos72h} videos, ${num(c.trend.tiktok.views72h)} views (72h)` : 'checking') : '<span class="dim">off (needs Apify key)</span>'}</div>`
        : '<div class="dim">checked for the most active coins only</div>'}
    </details>
    <div class="note">Scores come from public data that can be wrong, late or faked. LOW risk means fewer red flags were found, never that a coin is safe.</div>`;
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
  const body = Object.fromEntries(new FormData($('#settingsForm')));
  await post('/api/settings', body);
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
