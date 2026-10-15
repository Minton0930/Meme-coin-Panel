// AI chat about the coins on screen. The model gets a compact snapshot of the
// live data and is told to analyse risk, never to tell the user to buy or sell.
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';
import { coins } from './engine.js';

let client = null, clientKey = '';
function getClient() {
  if (!config.anthropicKey) return null;
  if (clientKey !== config.anthropicKey) { client = new Anthropic({ apiKey: config.anthropicKey }); clientKey = config.anthropicKey; }
  return client;
}

const SYSTEM = `You are the analyst inside a Solana memecoin risk terminal. You see live data for the coins on the user's screen (JSON below each message).

What you do:
- Explain rug-pull risk for specific coins using the data: mint/freeze authority, holder concentration, insider/sniper/bundle activity, dev wallet age and history, liquidity and LP lock, sell pressure, and social/trend signals.
- Compare coins, point out red flags the user may have missed, and say which data is missing or stale.
- Discuss risk management in general terms when asked (position sizing, never risking money you cannot lose, how fast memecoins go to zero, slippage, exit planning).

Hard rules:
- Never tell the user to buy, sell, ape, or hold a coin, and never give price targets or "this will 10x" style predictions. If asked "should I buy", explain the risk picture and say the decision is theirs.
- No score makes rug risk zero. A low risk score only means fewer red flags were found in the data available; most memecoins still lose most of their value.
- Say plainly when data is a heuristic (sniper/bundle detection, trend counts) or missing.
- Keep answers short and scannable: terse bullet points, numbers from the data, addresses shortened like AbCd…WxYz.`;

function snapshot(focus = []) {
  const list = [...coins.values()];
  const chosen = [
    ...focus.map(m => coins.get(m)).filter(Boolean),
    ...list.sort((a, b) => (b.momentum?.score ?? 0) - (a.momentum?.score ?? 0)).slice(0, 25),
  ];
  const seen = new Set();
  return chosen.filter(c => !seen.has(c.mint) && seen.add(c.mint)).slice(0, 30).map(c => ({
    mint: c.mint, symbol: c.symbol, name: c.name, demo: c.demo || undefined,
    ageMin: Math.round((Date.now() - (c.createdAt ?? c.market?.pairCreatedAt ?? c.firstSeen)) / 60_000),
    stage: c.pump && !c.pump.graduated ? 'bonding-curve' : c.market?.dexId,
    mcap: c.market?.mcap && Math.round(c.market.mcap), liq: c.market?.liqUsd && Math.round(c.market.liqUsd),
    vol5m: Math.round(c.market?.vol5m ?? 0), vol1h: Math.round(c.market?.vol1h ?? 0),
    buys5m: c.market?.buys5m, sells5m: c.market?.sells5m, chg5m: c.market?.change5m, chg1h: c.market?.change1h,
    holders: c.rug?.totalHolders,
    risk: c.risk && { score: c.risk.score, grade: c.risk.grade, coverage: c.risk.coverage, flags: c.risk.factors.filter(f => f.status !== 'ok').map(f => `${f.label}: ${f.detail}`) },
    momentum: c.momentum,
    trend: c.trend && { cgTrending: c.trend.coingeckoTrending, reddit1h: c.trend.reddit?.posts1h, tiktokViews72h: c.trend.tiktok?.views72h ?? (c.trend.tiktokEnabled ? 0 : 'not enabled') },
    newsMatch: c.newsMatch,
    focus: focus.includes(c.mint) || undefined,
  }));
}

export async function handleChat(req, res) {
  const client = getClient();
  if (!client) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('AI chat is off. Click SETTINGS (top right) and paste your Anthropic API key.');
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let parsed;
  try { parsed = JSON.parse(body); } catch { res.writeHead(400); res.end('bad json'); return; }
  const history = (parsed.messages ?? []).slice(-20).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string');
  if (!history.length || history[history.length - 1].role !== 'user') { res.writeHead(400); res.end('last message must be from user'); return; }

  const data = JSON.stringify(snapshot(parsed.focus ?? []));
  const messages = history.map((m, i) => i === history.length - 1
    ? { role: 'user', content: `${m.content}\n\n<live_data as_of="${new Date().toISOString()}">\n${data}\n</live_data>` }
    : m);

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache' });
  try {
    const stream = client.beta.messages.stream({
      model: config.chatModel,
      max_tokens: 16000,
      system: SYSTEM,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      messages,
    });
    for await (const ev of stream) {
      if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') res.write(ev.delta.text);
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') res.write('\n[The model declined to answer this one.]');
  } catch (e) {
    res.write(`\n[chat error: ${e.status ?? ''} ${e.message ?? e}]`);
  }
  res.end();
}
