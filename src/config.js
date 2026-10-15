import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(ROOT, '.env');

// Minimal .env reader/writer so the app has no extra dependencies and keys
// can be pasted into the dashboard's SETTINGS box instead of editing files.
function readEnvFile() {
  const out = {};
  if (!existsSync(envPath)) return out;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
const fileEnv = readEnvFile();
const env = (k, d = '') => String(process.env[k] ?? fileEnv[k] ?? '').trim() || d;
const list = s => s.split(',').map(x => x.trim().replace(/^@/, '')).filter(Boolean);

export const config = {
  port: Number(env('PORT', '8787')),
  demo: process.argv.includes('--demo') || env('DEMO') === '1',
  anthropicKey: env('ANTHROPIC_API_KEY'),
  chatModel: env('CHAT_MODEL', 'claude-opus-5-5'),
  rpcUrl: env('SOLANA_RPC_URL', 'https://api.mainnet-beta.solana.com'),
  rugcheckToken: env('RUGCHECK_TOKEN'),
  jupiterKey: env('JUPITER_API_KEY'),
  apifyToken: env('APIFY_TOKEN'),
  apifyActor: env('APIFY_TIKTOK_ACTOR', 'clockworks~free-tiktok-scraper'),
  xBearer: env('X_BEARER_TOKEN'),
  xAccounts: list(env('X_WATCH_ACCOUNTS', 'elonmusk,realDonaldTrump,cz_binance,MrBeast,KanyeWest')),
  newsTopics: list(env('NEWS_TOPICS', 'Elon Musk,Donald Trump,CZ Binance,MrBeast,memecoin')),
  wallet: env('WALLET_ADDRESS'), // public address only, for the MY TRADES page
  disablePumpportal: env('DISABLE_PUMPPORTAL') === '1',
  disableReddit: env('ENABLE_REDDIT') !== '1', // Reddit blocks keyless JSON since May 2026
  maxCoins: 400,
};

export const isPublicRpc = () => config.rpcUrl.includes('api.mainnet-beta.solana.com');

// Settings the dashboard may change. Values are saved to .env and applied live.
export const EDITABLE = {
  ANTHROPIC_API_KEY: { key: 'anthropicKey', secret: true },
  SOLANA_RPC_URL: { key: 'rpcUrl', secret: true },
  X_BEARER_TOKEN: { key: 'xBearer', secret: true },
  X_WATCH_ACCOUNTS: { key: 'xAccounts', list: true },
  NEWS_TOPICS: { key: 'newsTopics', list: true },
  WALLET_ADDRESS: { key: 'wallet' },
  APIFY_TOKEN: { key: 'apifyToken', secret: true },
};

export function publicSettings() {
  const out = {};
  for (const [name, d] of Object.entries(EDITABLE)) {
    const v = config[d.key];
    out[name] = d.secret ? (v && !(name === 'SOLANA_RPC_URL' && isPublicRpc()) ? 'set' : '') : d.list ? v.join(', ') : v;
  }
  return out;
}

export function saveSettings(updates) {
  const fileVals = readEnvFile();
  for (const [name, d] of Object.entries(EDITABLE)) {
    if (!(name in updates)) continue;
    const v = String(updates[name] ?? '').trim().replace(/[\r\n]/g, '');
    if (d.secret && v === '') continue; // blank secret box = keep the current value
    fileVals[name] = v;
    config[d.key] = d.list ? list(v) : v || (name === 'SOLANA_RPC_URL' ? 'https://api.mainnet-beta.solana.com' : '');
  }
  writeFileSync(envPath, Object.entries(fileVals).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
}
