import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { config, ROOT, isPublicRpc, publicSettings, saveSettings } from './src/config.js';
import { alerts, watchWords, addManual, removeWord, radarInfo } from './src/sources/news.js';
import { coins, start, pin, cadence } from './src/engine.js';
import { potentialScore } from './src/score.js';
import { startDemo } from './src/demo.js';
import { handleChat } from './src/chat.js';
import { statusSnapshot } from './src/http.js';
import { updateState, startUpdateCheck } from './src/update.js';
import { walletState, startWallet, checkWalletInput } from './src/wallet.js';
import { demoWallet } from './src/demo.js';

const PUBLIC = join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const httpUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null);
const xUrl = u => !u ? null : httpUrl(u) ?? (/^@?\w{1,15}$/.test(u) ? `https://x.com/${u.replace('@', '')}` : null);
const tgUrl = u => !u ? null : httpUrl(u) ?? (/^@?\w{3,32}$/.test(u) ? `https://t.me/${u.replace('@', '')}` : null);

// Best-known X / Telegram / website for a coin, from pump.fun, Jupiter and DexScreener.
export function socials(c) {
  const all = [...(c.links ?? []), ...(c.market?.socials ?? [])];
  const find = re => all.find(l => re.test(l.type ?? '') || re.test(l.url ?? ''))?.url;
  return {
    twitter: xUrl(c.info?.twitter) ?? xUrl(c.jup?.twitter) ?? httpUrl(find(/twitter|x\.com/i)),
    telegram: tgUrl(c.info?.telegram) ?? tgUrl(c.jup?.telegram) ?? httpUrl(find(/telegram|t\.me/i)),
    website: httpUrl(c.info?.website) ?? httpUrl(c.jup?.website) ?? httpUrl(all.find(l => /website/i.test(l.type ?? ''))?.url),
  };
}

function summary(c) {
  const m = c.market ?? {};
  const holders = c.rug?.holders?.length ? c.rug.holders : c.chain?.holders;
  return {
    mint: c.mint, symbol: c.symbol, name: c.name, image: c.image ?? m.image ?? c.info?.image ?? c.jup?.icon, demo: c.demo,
    createdAt: c.createdAt ?? m.pairCreatedAt ?? c.firstSeen,
    stage: c.pump && !c.pump.graduated ? 'curve' : m.dexId ?? (c.pump ? 'curve' : '?'),
    mcap: m.mcap ?? c.info?.usdMcap, liq: m.liqUsd, vol5m: m.vol5m, vol1h: m.vol1h, chg5m: m.change5m, chg1h: m.change1h,
    buys5m: m.buys5m, sells5m: m.sells5m,
    holders: c.rug?.totalHolders ?? c.jup?.holders,
    top10: holders ? holders.slice(0, 10).reduce((s, h) => s + h.pct, 0) : c.jup?.topHoldersPct ?? null,
    risk: c.risk?.score, grade: c.risk?.grade, coverage: c.risk?.coverage,
    flag: c.risk?.factors.find(f => f.status === 'bad')?.label,
    mom: c.momentum?.score,
    pot: potentialScore(c.risk, c.momentum),
    // The main feed: coins that pass the potential filter AND are new or were posted/talked about.
    feed: potentialScore(c.risk, c.momentum) != null && (Date.now() - (c.createdAt ?? m.pairCreatedAt ?? c.firstSeen ?? 0) < 2 * 3600_000 || !!c.newsMatch || !!c.gtRank),
    bundle: c.bundle ?? null,
    why: c.momentum?.reasons?.slice(0, 2),
    organic: c.jup?.organicScore != null ? Math.round(c.jup.organicScore) : null,
    gtRank: c.gtRank ?? null,
    replies: c.info?.replies ?? null,
    social: !!(c.trend?.coingeckoTrending || c.trend?.reddit?.posts1h > 2 || c.gtRank),
    links: socials(c),
    sources: c.sources,
    news: c.newsMatch,
  };
}

function sse(req, res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const push = () => {
    const payload = {
      t: Date.now(), demo: config.demo, cadence, publicRpc: isPublicRpc(), newsTopics: config.newsTopics,
      chat: !!config.anthropicKey, tiktok: !!config.apifyToken, x: !!config.xBearer, xAccounts: config.xAccounts,
      update: updateState, radar: radarInfo(),
      alerts: alerts.slice(0, 30),
      watch: [...watchWords.values()].sort((a, b) => (b.source === 'manual') - (a.source === 'manual') || b.at - a.at).slice(0, 40)
        .map(w => ({ kw: w.kw, source: w.source, strong: w.strong, author: w.author, text: w.text?.slice(0, 160), url: w.url, at: w.at })),
      status: statusSnapshot(), coins: [...coins.values()].map(summary),
    };
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  push();
  const iv = setInterval(push, 1000);
  req.on('close', () => clearInterval(iv));
}

async function readJson(req) {
  let b = '';
  for await (const ch of req) { b += ch; if (b.length > 20_000) break; }
  try { return JSON.parse(b); } catch { return {}; }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/stream') return sse(req, res);
    if (url.pathname === '/api/chat' && req.method === 'POST') {
      if (req.headers['x-rugradar'] !== '1') { res.writeHead(403); return res.end('forbidden'); }
      return handleChat(req, res);
    }
    if (url.pathname.startsWith('/api/settings') || url.pathname.startsWith('/api/watch')) {
      // Changes need a custom header, so other websites open in your browser cannot make them.
      if (req.method !== 'GET' && req.headers['x-rugradar'] !== '1') { res.writeHead(403); return res.end('forbidden'); }
      const body = req.method === 'POST' ? await readJson(req) : {};
      let walletError = null;
      if (url.pathname === '/api/settings' && req.method === 'POST') {
        if ('WALLET_ADDRESS' in body) {
          const w = checkWalletInput(body.WALLET_ADDRESS);
          // A private key or seed phrase is dropped here and never written anywhere.
          if (!w.ok) { delete body.WALLET_ADDRESS; walletError = w.secret ? 'secret' : 'invalid'; } else body.WALLET_ADDRESS = w.value;
        }
        saveSettings(body);
      }
      else if (url.pathname === '/api/watch' && req.method === 'POST') addManual(body.word ?? '');
      else if (url.pathname === '/api/watch' && req.method === 'DELETE') removeWord(url.searchParams.get('kw'));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...publicSettings(), walletError }));
    }
    if (url.pathname === '/api/trades') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(config.demo ? demoWallet() : walletState));
    }
    const cm = url.pathname.match(/^\/api\/coin\/([1-9A-HJ-NP-Za-km-z]{32,48})$/);
    if (cm) {
      const c = coins.get(cm[1]);
      if (!c) { res.writeHead(404); return res.end('{}'); }
      if (!config.demo) pin(c.mint);
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ...c, socials: socials(c), pot: potentialScore(c.risk, c.momentum) }));
    }
    // Static files
    const rel = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^(\.\.[/\\])+/, '');
    const file = join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    const data = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    if (!res.headersSent) res.writeHead(404);
    res.end('not found');
  }
});

server.listen(config.port, '127.0.0.1', () => {
  console.log(`\n  MEMECOIN ANALYZER  ->  http://localhost:${config.port}`);
  console.log(`  mode: ${config.demo ? 'DEMO (fake data)' : 'LIVE'} | chat: ${config.anthropicKey ? 'on' : 'off (no ANTHROPIC_API_KEY)'} | rpc: ${isPublicRpc() ? 'public (slow)' : 'custom'} | tiktok: ${config.apifyToken ? 'apify' : 'off'}`);
  console.log('  Analysis only. Never trades, never asks for keys. Not financial advice.\n');
  startUpdateCheck();
  if (config.demo) startDemo(); else { start(); startWallet(m => coins.get(m)); }
});
