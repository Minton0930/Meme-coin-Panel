// News radar: collects "watch words" from
//   1. posts by big X accounts (needs a paid X API plan: X_BEARER_TOKEN),
//   2. Google News headlines about those people (free, no key, a few minutes behind),
//   3. words you type yourself in the dashboard (free, instant).
// Every new coin is checked against the live watch words the moment it appears.
import { Limiter, getJson, record } from '../http.js';
import { config } from '../config.js';
import { extractKeywords, matchCoin } from '../newsmatch.js';

const xLim = new Limiter('x-api', 15_000);       // X Basic: 60 recent-search calls / 15 min
const gLim = new Limiter('google-news', 20_000);

const TTL = { x: 12 * 3600_000, news: 3 * 3600_000, manual: Infinity };
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

const decode = s => s.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export function startNewsRadar() {
  const loop = async (fn, ms) => { for (;;) { try { await fn(); } catch {} expire(); await new Promise(r => setTimeout(r, ms)); } };
  loop(pollX, 15_000);
  loop(pollGoogleNews, 120_000);
}
