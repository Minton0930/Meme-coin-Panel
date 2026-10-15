// PumpPortal free data websocket: real-time pump.fun launches, migrations,
// and trades for tokens we subscribe to. Used for the "new launches" feed and
// for the early-buyer (sniper / bundle) heuristic during each coin's first minute.
import { sourceStatus } from '../http.js';

const URL = 'wss://pumpportal.fun/api/data';
const PUMP_SUPPLY = 1_000_000_000; // pump.fun tokens mint 1B supply
const WATCH_MS = 60_000;           // follow trades for the first minute
const SNIPE_WINDOW_MS = 5_000;     // buys this soon after create count as snipes

export function startPumpPortal({ onCreate, onEarly, onMigrate, log = console.log }) {
  sourceStatus.pumpportal = { ok: 0, fail: 0, lastOk: null, lastError: null, recent: [], connected: false };
  const st = sourceStatus.pumpportal;
  const watching = new Map(); // mint -> early stats
  let ws, retry = 1000;

  const send = obj => { try { ws?.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };

  function connect() {
    ws = new WebSocket(URL);
    ws.onopen = () => {
      st.connected = true; retry = 1000;
      send({ method: 'subscribeNewToken' });
      send({ method: 'subscribeMigration' });
      const keys = [...watching.keys()];
      if (keys.length) send({ method: 'subscribeTokenTrade', keys });
      log('[pumpportal] connected');
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const now = Date.now();
      st.ok++; st.lastOk = now; st.recent.push(now);
      while (st.recent.length && st.recent[0] < now - 60_000) st.recent.shift();
      if (m.txType === 'create' && m.mint) handleCreate(m, now);
      else if ((m.txType === 'buy' || m.txType === 'sell') && watching.has(m.mint)) handleTrade(m, now);
      else if (m.txType === 'migrate' || (m.mint && m.pool && !m.txType)) onMigrate?.(m.mint);
    };
    ws.onclose = () => {
      st.connected = false;
      st.fail++; st.lastError = { at: Date.now(), msg: 'socket closed, reconnecting' };
      setTimeout(connect, retry); retry = Math.min(retry * 2, 30_000);
    };
    ws.onerror = () => {};
  }

  function handleCreate(m, now) {
    const devPct = m.initialBuy ? (m.initialBuy / PUMP_SUPPLY) * 100 : 0;
    const early = { createdAt: now, creator: m.traderPublicKey, devBuyPct: devPct, buyers: new Map(), snipeBuys: 0, snipePct: 0, devSoldPct: 0, sells: 0, buys: 0 };
    watching.set(m.mint, early);
    send({ method: 'subscribeTokenTrade', keys: [m.mint] });
    setTimeout(() => finishWatch(m.mint), WATCH_MS);
    onCreate?.({
      mint: m.mint, name: m.name, symbol: m.symbol, uri: m.uri, creator: m.traderPublicKey,
      bondingCurve: m.bondingCurveKey, mcapSol: m.marketCapSol, devBuyPct: devPct, createdAt: now, pool: m.pool,
    });
  }

  function handleTrade(m, now) {
    const e = watching.get(m.mint);
    const pct = ((m.tokenAmount ?? 0) / PUMP_SUPPLY) * 100;
    if (m.txType === 'buy') {
      e.buys++;
      const b = e.buyers.get(m.traderPublicKey) ?? { pct: 0, firstAt: now };
      b.pct += pct; e.buyers.set(m.traderPublicKey, b);
      if (now - e.createdAt <= SNIPE_WINDOW_MS && m.traderPublicKey !== e.creator) { e.snipeBuys++; e.snipePct += pct; }
    } else {
      e.sells++;
      if (m.traderPublicKey === e.creator) e.devSoldPct += pct;
    }
    emit(m.mint, e, false);
  }

  function emit(mint, e, final) {
    onEarly?.(mint, {
      final,
      windowSec: Math.round((Date.now() - e.createdAt) / 1000),
      devBuyPct: e.devBuyPct,
      devSoldPct: e.devSoldPct,
      devSoldAll: e.devBuyPct > 0 && e.devSoldPct >= e.devBuyPct * 0.9,
      snipeBuys: e.snipeBuys,
      snipePct: e.snipePct,
      uniqueBuyers: e.buyers.size,
      buys: e.buys,
      sells: e.sells,
    });
  }

  function finishWatch(mint) {
    const e = watching.get(mint);
    if (!e) return;
    emit(mint, e, true);
    watching.delete(mint);
    send({ method: 'unsubscribeTokenTrade', keys: [mint] });
  }

  connect();
}
