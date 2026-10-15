// Shared fetch helper: per-source rate limiting, timeouts, backoff on 429,
// and a small status record the dashboard shows so refresh rates are honest.

export const sourceStatus = {};

export class Limiter {
  constructor(name, minIntervalMs) {
    this.name = name;
    this.minIntervalMs = minIntervalMs;
    this.next = 0;
    this.chain = Promise.resolve();
    sourceStatus[name] ??= { ok: 0, fail: 0, lastOk: null, lastError: null, recent: [] };
  }
  take() {
    const p = this.chain.then(async () => {
      const wait = this.next - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.next = Date.now() + this.minIntervalMs;
    });
    this.chain = p.catch(() => {});
    return p;
  }
  backoff(ms) { this.next = Math.max(this.next, Date.now() + ms); }
}

export function record(name, ok, err) {
  const s = (sourceStatus[name] ??= { ok: 0, fail: 0, lastOk: null, lastError: null, recent: [] });
  const now = Date.now();
  s.recent.push(now);
  while (s.recent.length && s.recent[0] < now - 60_000) s.recent.shift();
  if (ok) { s.ok++; s.lastOk = now; } else { s.fail++; s.lastError = { at: now, msg: String(err).slice(0, 200) }; }
}

export async function getJson(limiter, url, { headers = {}, method = 'GET', body, timeoutMs = 12_000 } = {}) {
  await limiter.take();
  try {
    const res = await fetch(url, {
      method,
      headers: { accept: 'application/json', 'user-agent': 'memecoin-analyzer/0.1 (analysis only)', ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after')) || 10;
      limiter.backoff(ra * 1000);
      throw new Error('429 rate limited');
    }
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    const json = await res.json();
    record(limiter.name, true);
    return json;
  } catch (e) {
    record(limiter.name, false, e.message ?? e);
    throw e;
  }
}

export function statusSnapshot() {
  const out = {};
  for (const [k, s] of Object.entries(sourceStatus)) {
    out[k] = { reqPerMin: s.recent.length, ok: s.ok, fail: s.fail, lastOk: s.lastOk, lastError: s.lastError };
  }
  return out;
}
