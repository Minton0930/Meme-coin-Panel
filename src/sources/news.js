// News radar: collects "watch words" from
//   1. built-in big accounts that have a FREE public feed: Trump's Truth Social
//      (via the trumpstruth.org mirror) and Telegram channel previews of big
//      crypto news accounts (t.me/s/...), polled every ~30s,
//   2. Google News headlines about big names (free, a few minutes behind),
//   3. posts by X accounts, ONLY if you add a paid X API key (X has no free feed),
//   4. words you type yourself in the dashboard (free, instant).
// Every new coin is checked against the live watch words the moment it appears.
import { Limiter, getJson, record } from '../http.js';
import { config } from '../config.js';
import { extractKeywords, matchCoin } from '../newsmatch.js';

const xLim = new Limiter('x-api', 15_000);       // X Basic: 60 recent-search calls / 15 min
const gLim = new Limiter('google-news', 20_000);

const TTL = { x: 12 * 3600_000, social: 12 * 3600_000, news: 3 * 3600_000, manual: Infinity };
const sLim = new Limiter('social-feeds', 2_500);
export const watchWords = new Map(); // kw -> { kw, strong, source, text, url, author, at }
export const alerts = [];            // newest first
let sinceId = null;
let wordHook = () => {};
// Called with each new watch word so recent coins get checked against it.
export function setWordHook(fn) { wordHook = fn; }
const seenHeadlines = new Set();

export function addWatchWord(kw, info) {
  const cur = watchWords.get(kw);
  if (cur && cur.source === 'manual' && info.source !== 'manual') return;
  if (cur && cur.strong && !info.strong) return;
  watchWords.set(kw, { kw, ...info });
}

export function addManual(word) {
  const kw = String(word).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (kw.length < 3) return false;
  const info = { strong: true, source: 'manual', text: `You are watching "${word}"`, at: Date.now() };
  addWatchWord(kw, info);
  wordHook({ kw, ...info });
  return true;
}
export function removeWord(kw) { watchWords.delete(kw); }

function expire() {
  const now = Date.now();
  for (const [k, w] of watchWords) if (now - w.at > TTL[w.source]) watchWords.delete(k);
}

// Called for every coin the moment it is first seen (and for recent coins when a new word arrives).
export function checkCoin(coin, onlyWord) {
  const words = onlyWord ? [onlyWord] : [...watchWords.values()];
  for (const w of words) {
    const how = matchCoin(coin, w.kw);
    if (!how) continue;
    if (alerts.some(a => a.mint === coin.mint && a.keyword === w.kw)) continue;
    const created = coin.createdAt ?? coin.firstSeen ?? Date.now();
    const a = {
      id: `${coin.mint}:${w.kw}`, at: Date.now(), mint: coin.mint, symbol: coin.symbol, name: coin.name,
      keyword: w.kw, match: how, strong: w.strong || how === 'exact', source: w.source,
      postText: w.text?.slice(0, 280), postUrl: w.url, author: w.author,
      secsAfterPost: Math.round((created - w.at) / 1000),
    };
    alerts.unshift(a);
    if (alerts.length > 200) alerts.pop();
    coin.newsMatch = { keyword: w.kw, source: w.source, strong: a.strong, author: w.author, text: w.text?.slice(0, 140), url: w.url };
  }
}

async function pollX() {
  if (!config.xBearer) return;
  const handles = config.xAccounts.slice(0, 20);
  const query = `(${handles.map(h => `from:${h}`).join(' OR ')}) -is:retweet`;
  const url = new URL('https://api.x.com/2/tweets/search/recent');
  url.searchParams.set('query', query);
  url.searchParams.set('max_results', '10');
  url.searchParams.set('tweet.fields', 'created_at,author_id');
  url.searchParams.set('expansions', 'author_id');
  url.searchParams.set('user.fields', 'username');
  if (sinceId) url.searchParams.set('since_id', sinceId);
  const r = await getJson(xLim, url.toString(), { headers: { authorization: `Bearer ${config.xBearer}` } });
  const users = new Map((r.includes?.users ?? []).map(u => [u.id, u.username]));
  const tweets = r.data ?? [];
  if (r.meta?.newest_id) sinceId = r.meta.newest_id;
  for (const t of tweets.reverse()) {
    const author = users.get(t.author_id) ?? '?';
    const at = Date.parse(t.created_at) || Date.now();
    for (const k of extractKeywords(t.text, { ignore: [author] })) {
      const info = { strong: k.strong, source: 'x', text: t.text, url: `https://x.com/${author}/status/${t.id}`, author: `@${author}`, at };
      addWatchWord(k.kw, info);
      wordHook({ kw: k.kw, ...info });
    }
  }
}

async function pollGoogleNews() {
  const people = config.newsTopics;
  for (const who of people) {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`"${who}" when:1h`)}&hl=en-US&gl=US&ceid=US:en`;
    await gLim.take();
    let xml;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'memecoin-analyzer/0.2' } });
      if (!res.ok) throw new Error(`${res.status}`);
      xml = await res.text();
      record('google-news', true);
    } catch (e) {
      record('google-news', false, e.message ?? e);
      continue;
    }
    for (const item of xml.split('<item>').slice(1, 15)) {
      const title = decode((item.match(/<title>([\s\S]*?)<\/title>/) ?? [])[1] ?? '').replace(/\s+-\s+[^-]+$/, '');
      const link = decode((item.match(/<link>([\s\S]*?)<\/link>/) ?? [])[1] ?? '');
      const at = Date.parse((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? [])[1] ?? '') || Date.now();
      if (!title || seenHeadlines.has(title)) continue;
      seenHeadlines.add(title);
      for (const k of extractKeywords(title, { headline: true, ignore: who.split(/\s+/) })) {
        // Headlines are noisy, so only names the headline clearly introduces become watch words.
        if (!k.strong) continue;
        const info = { strong: true, source: 'news', text: title, url: link, author: who, at };
        addWatchWord(k.kw, info);
        wordHook({ kw: k.kw, ...info });
      }
    }
  }
  if (seenHeadlines.size > 5000) seenHeadlines.clear();
}

// Built-in accounts with free public feeds (checked October 2026).
export const SOCIAL = [
  { kind: 'rss', url: 'https://trumpstruth.org/feed', author: '@realDonaldTrump (Truth Social)', ignore: ['Trump', 'Donald', 'President'] },
  { kind: 'tg', channel: 'WatcherGuru', author: '@WatcherGuru' },
  { kind: 'tg', channel: 'lookonchainchannel', author: '@lookonchain' },
  { kind: 'tg', channel: 'whale_alert_io', author: '@whale_alert' },
];
const seenPosts = new Set();
const strip = h => decode(h.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export async function fetchText(url) {
  await sLim.take();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(12_000), headers: { 'user-agent': 'Mozilla/5.0 (memecoin-analyzer; analysis only)' } });
    if (!res.ok) throw new Error(`${res.status}`);
    const t = await res.text();
    record('social-feeds', true);
    return t;
  } catch (e) { record('social-feeds', false, `${url.split('/')[2]}: ${e.message ?? e}`); throw e; }
}

// Telegram public preview page -> [{ id, text, at, url }]
export function parseTelegram(html, channel) {
  const out = [];
  for (const chunk of html.split('data-post="').slice(1)) {
    const id = chunk.slice(0, chunk.indexOf('"'));
    const tm = chunk.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    const at = Date.parse((chunk.match(/<time[^>]*datetime="([^"]+)"/) ?? [])[1] ?? '') || Date.now();
    if (tm) out.push({ id: `tg:${id}`, text: strip(tm[1]), at, url: `https://t.me/${id}` });
  }
  return out;
}
export function parseRss(xml) {
  return xml.split('<item>').slice(1, 20).map(item => {
    const pick = tag => decode((item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`)) ?? [])[1] ?? '');
    const link = pick('link');
    const text = strip(pick('description') || pick('title'));
    return { id: `rss:${pick('guid') || link}`, text, at: Date.parse(pick('pubDate')) || Date.now(), url: link };
  });
}

async function pollSocial() {
  for (const src of SOCIAL) {
    let posts;
    try {
      const body = await fetchText(src.kind === 'tg' ? `https://t.me/s/${src.channel}` : src.url);
      posts = src.kind === 'tg' ? parseTelegram(body, src.channel) : parseRss(body);
    } catch { continue; }
    for (const p of posts) {
      if (!p.text || seenPosts.has(p.id) || Date.now() - p.at > 2 * 3600_000) continue;
      seenPosts.add(p.id);
      const long = p.text.length > 200;
      for (const k of extractKeywords(p.text, { headline: long, ignore: src.ignore ?? [] })) {
        if (long && !k.strong) continue;
        const info = { strong: k.strong, source: 'social', text: p.text, url: p.url, author: src.author, at: p.at };
        addWatchWord(k.kw, info);
        wordHook({ kw: k.kw, ...info });
      }
    }
  }
  if (seenPosts.size > 20_000) seenPosts.clear();
}

export function radarInfo() {
  const n = SOCIAL.length + config.newsTopics.length + (config.xBearer ? config.xAccounts.length : 0);
  return { accounts: n, cadence: `big accounts every ~30s (Truth Social + Telegram news channels) · headlines every 2 min${config.xBearer ? ' · X every 15s' : ''} · your words instantly` };
}

const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function startNewsRadar() {
  const loop = async (fn, ms) => { for (;;) { try { await fn(); } catch {} expire(); await new Promise(r => setTimeout(r, ms)); } };
  loop(pollX, 15_000);
  loop(pollSocial, 30_000);
  loop(pollGoogleNews, 120_000);
}
