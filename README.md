# RUGRADAR: Solana memecoin radar

Watches every new Solana memecoin as it launches, warns you about rug pulls, shows what's hot right now, and alerts you when a coin launches that matches something big accounts just posted about (for example a new dog called Elsa).

It does **not** tell you to buy or sell, never trades, and never asks for your wallet or seed phrase. "LOW risk" means fewer red flags were found. It never means safe.

![dashboard](docs/screenshot.png)

## Start it (Windows)

1. Install Node.js from https://nodejs.org (the "LTS" button) if you haven't already.
2. Open the `memecoin-analyzer` folder.
3. Double-click **`start.bat`**. The dashboard opens in your browser at http://localhost:8787.

Want to try it with fake coins first? Double-click **`demo.bat`** instead.

To stop it, close the black window.

### Updates

Once updates are switched on (see `update-source.txt`), `start.bat` downloads the newest version every time you start it. Your keys and settings are kept. If a new version comes out while the app is open, an amber bar at the bottom tells you to close it and start it again. If there's no internet, it starts the version you already have.

## Everything is free

All coin data comes from free public sources with no keys: pump.fun, DexScreener, Jupiter, GeckoTerminal, RugCheck, Solana RPC, CoinGecko, Reddit and Google News.

Optional, in **⚙ SETTINGS** (no file editing needed):

| Setting | What it does | Cost |
|---|---|---|
| Solana RPC URL from Helius | Much faster rug checks | Free (helius.dev) |
| People to watch in news headlines | Names for the news radar | Free |
| Anthropic API key | The AI analyst chat | Paid per use. The only paid part, and optional |

Reading X posts live needs a paid X API plan, so it's left out. The free headlines and your own watch words do that job instead.

## What's on the screen

- **News radar:** type a word you just saw in a post (like a new dog's name) and any coin launched with that name pops up with a beep the second it appears. Headlines about the people you pick add words automatically, a few minutes behind X.
- **Top potential now:** the 5 coins with the best mix of lower rug risk and strong activity right now. It's a filter, not a prediction.
- **Coins:** opens on **HIGH POTENTIAL**, which only shows coins that are LOW or MEDIUM risk, mostly checked, and active. HIGH and DANGER risk coins are hidden everywhere unless you tick **SHOW RISKY**. Other views: ALL, NEW, TRENDING, NEWS MATCH. Each coin shows its picture and buttons for X, Telegram, website, pump.fun and the chart, plus age, market cap, liquidity, volume, holders, top-10 %, RISK, HYPE and POTENTIAL.
- **Coin check:** click a coin for its description, all its links (X search, pump.fun, chart, Jupiter, RugCheck, Bubblemaps, Solscan), the three scores, and "What we found" in plain English. **More detail** shows the full score breakdown and top holders.
- **AI analyst:** ask anything about the coins on screen. It explains the risk. It won't tell you to buy or sell.

## Good to know

- Every news name gets dozens of copycat coins within minutes, and most are dumped fast. Always check the risk first.
- pump.fun launches coins faster than free data sources can check them all. Coins marked "checking" haven't been fully checked yet, so treat them as riskier.
- "Potential" means fewer red flags plus lots of activity right now. Coins that pass can still dump.
- TikTok has no free public API, so TikTok trends aren't included.
- Wallet tricks can hide holder concentration. The checks catch a lot, not everything.

## For the technical side

Commands: `npm start`, `npm run demo`, `npm test`. You can also set keys in `.env` (see `.env.example`).

```
server.js               web server, 1-second live stream, settings and watch-word API
src/engine.js           coin table, schedules each data source within its rate limit
src/score.js            rug-risk and hype scoring
src/newsmatch.js        turns posts and headlines into watch words, matches coin names
src/sources/news.js     Google News, your watch words, alerts
src/sources/*.js        DexScreener, PumpPortal, pump.fun info, Jupiter, GeckoTerminal, RugCheck, Solana RPC, trends
src/chat.js             AI analyst
src/update.js           tells the open dashboard when a newer version is published
update.ps1              downloads the newest version (run by start.bat), keeps .env
public/                 dashboard (terminal theme)
```

Real update speeds: new pump.fun launches arrive instantly. Prices for the most active coins refresh every second, and the rest every 10–25 seconds. Rug checks take about 2 seconds per coin, most active coins first. Jupiter checks 50 coins every ~2 seconds, pump.fun coin info about 3 coins a second, GeckoTerminal trending every minute, headlines every 2 minutes, and your own watch words apply instantly.
