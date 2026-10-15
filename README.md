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

Once updates are switched on (see `update-source.txt`), `start.bat` downloads the newest version every time you start it. Your keys and settings are kept. If a new version comes out while the app is open, a gold bar at the bottom tells you to close it and start it again. If there's no internet, it starts the version you already have.

## Add your keys (optional)

Click **⚙ SETTINGS** at the top right of the dashboard, paste a key, and press SAVE. You don't have to edit any files.

| Key | What it turns on | Cost |
|---|---|---|
| Anthropic API key | The AI analyst chat | Pay per use (console.anthropic.com) |
| Solana RPC URL from Helius | Much faster rug checks | Free tier is enough (helius.dev) |
| X bearer token | Instant alerts from X posts | **Paid X API plan** (developer.x.com). X's free tier can't read posts. |
| Apify token | TikTok search | Paid per search (apify.com) |

## What's on the screen

- **News radar:** watch words come from three places:
  - **X posts** from the accounts you pick (Elon Musk first by default). Checked every 15 seconds. Needs the paid X key.
  - **News headlines** about the people you pick. Free, but a few minutes behind X.
  - **Words you type** in the "watch a word" box. Free and instant. If you hear about something first, type it in.

  When a pump.fun coin launches with a matching name or ticker, it pops up as a **NEWS MATCH** with a beep and a desktop notification. It shows how many seconds after the post the coin launched. A coin that launched *before* the post is flagged too.
- **Hot right now:** the 5 coins with the most activity and hype this minute: volume speeding up, lots of buys, price moving, social buzz. It shows what is moving, not what will go up.
- **All coins:** every coin with its age, market cap, 5-minute volume and change, **RISK** (LOW / MEDIUM / HIGH / DANGER) and **HYPE**. The filters are NEW, NEWS MATCH, LOW RISK + HOT, and DANGER.
- **Coin check:** click a coin to see "What we found" in plain English. For example: dev can still create more coins, top 10 wallets own 52%, bots bought 20% at launch, liquidity isn't locked, dev wallet is brand new. It also has a copy-address button and links to the chart, RugCheck and Bubblemaps. **More detail** shows the full score breakdown.
- **AI analyst:** ask anything about the coins on screen. It explains the risk. It won't tell you to buy or sell.

## Good to know

- Every news name gets dozens of copycat coins within minutes, and most are dumped fast. Always check the risk first.
- pump.fun launches coins faster than free data sources can check them all. Coins marked "checking" haven't been fully checked yet, so treat them as riskier.
- TikTok has no open public API. The only legal option is the paid Apify scraper.
- Wallet tricks can hide holder concentration. The checks catch a lot, not everything.

## For the technical side

Commands: `npm start`, `npm run demo`, `npm test`. You can also set keys in `.env` (see `.env.example`).

```
server.js               web server, 1-second live stream, settings and watch-word API
src/engine.js           coin table, schedules each data source within its rate limit
src/score.js            rug-risk and hype scoring
src/newsmatch.js        turns posts and headlines into watch words, matches coin names
src/sources/news.js     X API, Google News, your watch words, alerts
src/sources/*.js        DexScreener, PumpPortal (pump.fun), RugCheck, Solana RPC, trends
src/chat.js             AI analyst
src/update.js           tells the open dashboard when a newer version is published
update.ps1              downloads the newest version (run by start.bat), keeps .env
public/                 dashboard; public/art/scene.svg is the original painted background (scene.jpg is its render)
```

Real update speeds: new pump.fun launches arrive instantly. Prices for the most active coins refresh every second, and the rest every 10–25 seconds. Rug checks take about 2 seconds per coin, most active coins first. X posts are checked every 15 seconds, headlines every 2 minutes, and your own watch words apply instantly.
