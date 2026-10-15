// PumpPortal free data websocket: real-time pump.fun launches and migrations.
// (Per-coin trade streams are a paid PumpPortal feature, so bundles and snipers
// are checked from the chain instead: see bundleCheck in solana.js.)
import { sourceStatus } from '../http.js';

const URL = 'wss://pumpportal.fun/api/data';
const PUMP_SUPPLY = 1_000_000_000; // pump.fun tokens mint 1B supply

export function startPumpPortal({ onCreate, onMigrate, log = console.log }) {
  sourceStatus.pumpportal = { ok: 0, fail: 0, lastOk: null, lastError: null, recent: [], connected: false };
  const st = sourceStatus.pumpportal;
  let ws, retry = 1000;
  const send = obj => { try { ws?.readyState === 1 && ws.send(JSON.stringify(obj)); } catch {} };

  function connect() {
    ws = new WebSocket(URL); // one connection only: PumpPortal bans clients that open many
    ws.onopen = () => {
      st.connected = true; retry = 1000;
      send({ method: 'subscribeNewToken' });
      send({ method: 'subscribeMigration' });
      log('[pumpportal] connected');
    };
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const now = Date.now();
      st.ok++; st.lastOk = now; st.recent.push(now);
      while (st.recent.length && st.recent[0] < now - 60_000) st.recent.shift();
      if (m.txType === 'create' && m.mint) {
        onCreate?.({
          mint: m.mint, name: m.name, symbol: m.symbol, uri: m.uri, creator: m.traderPublicKey,
          bondingCurve: m.bondingCurveKey, mcapSol: m.marketCapSol, devBuyPct: m.initialBuy ? (m.initialBuy / PUMP_SUPPLY) * 100 : 0, createdAt: now, pool: m.pool,
        });
      } else if (m.txType === 'migrate' || (m.mint && m.pool && !m.txType)) onMigrate?.(m.mint);
    };
    ws.onclose = () => {
      st.connected = false;
      st.fail++; st.lastError = { at: Date.now(), msg: 'socket closed, reconnecting' };
      setTimeout(connect, retry); retry = Math.min(retry * 2, 30_000);
    };
    ws.onerror = () => {};
  }
  connect();
}
