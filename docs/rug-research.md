# Rug-pull and bundle research (October 2026)

What the app now checks, why, and where the thresholds come from. These are screening rules used by other tools, not guarantees. No filter catches every rug.

## The base rate

About 98.6% of pump.fun tokens are tied to rugs or pump-and-dumps, and only about 1.4% graduate ([Solidus Labs via Forklog](https://forklog.com/en/report-98-of-pump-funs-memecoins-deemed-scams/), [Killy7](https://killy7.substack.com/p/serial-token-deployers-on-solana)). So the app treats every coin as risky until it passes the checks.

## What blocks a coin from the feed

A coin only gets a POTENTIAL score (and only then shows in the feed) when its risk is LOW or MEDIUM, at least 80% of checks are done, there is **no red (bad) finding at all**, and young pump.fun coins have **passed the launch-bundle check**.

| Check | Red flag (blocks) | Warning | Source |
|---|---|---|---|
| Launch bundle: wallets buying in the launch block or the next 2 blocks | 10% or more of supply | 5% or more, or 3+ wallets in the launch block | [Bubblemaps](https://blog.bubblemaps.io/whats-the-difference-between-bundle-cluster-2/), [SolanaTracker](https://docs.solanatracker.io/data-api/risk.md), [Mobula](https://docs.mobula.io/almanac/detecting-snipers-bundlers.md) |
| Mint authority still active | always | | SolanaTracker |
| Freeze authority still active | always | | SolanaTracker |
| Token-2022 tricks: permanent delegate, transfer hook, default-frozen accounts, pausable, transfer fee 5%+ or changeable | always | small fixed fee | [InsightX](https://docs.insightx.network/reference/scanner-solana-indicators), [Cointelegraph](https://cointelegraph.com/news/new-solana-scam-burn-tokens-from-inside-sol-wallets) |
| Top 10 holders (pool excluded) | above 35% | above 15% | Mobula, [BloFin](https://blofin.com/academy/education/solana-memecoin-rug-pull-safety) |
| Largest single holder | above 8% | above 4% | SolanaTracker |
| Dev still holding | above 10% | above 3% | Mobula, SolanaTracker |
| Dev wallet age | under 7 days | under 30 days | BloFin |
| Serial launcher (dev's other tokens) | 5 or more | 2 or more | Killy7, Jupiter `devMints` |
| LP not locked or burned (non-pump pools) | under 50% | under 90% | RugCheck, SolanaTracker |
| Fake volume | | Jupiter organic score under 10, or 1h volume over 15x liquidity with under 300 holders | BloFin, Jupiter |
| RugCheck "danger" findings, Jupiter "suspicious" flag | always | | RugCheck, Jupiter |

## Changes forced by the research

- **PumpPortal's per-coin trade stream is now paid.** The app no longer uses it. Bundles and snipers are read from the chain instead (the coin's first transactions), which costs about 25 RPC calls per coin. That's why it only runs on coins that already look clean, and why a free Helius RPC key makes it much faster.
- **Reddit blocks keyless requests since May 2026**, so Reddit is off by default.
- **Jupiter is moving its token API behind keys.** The app keeps using the keyless host and switches to the keyed one if you add `JUPITER_API_KEY` to `.env`.

## Reading big accounts for free

There is no free, reliable live feed of X posts in October 2026. Nitter was shut down by X in August 2026, xcancel is suspended, and the X syndication endpoints block bots. The app uses the free routes that work instead:

- Trump's Truth Social posts through the [trumpstruth.org](https://trumpstruth.org/feed) mirror, every ~30s.
- Telegram channel previews of big crypto news accounts (WatcherGuru, Lookonchain, Whale Alert), every ~30s.
- Google News headlines about Elon Musk, Trump, CZ, MrBeast and "memecoin", every 2 minutes.
- Words you type yourself, instantly.

Elon's own X posts reach the app only through news channels and headlines, usually within minutes. Reading X directly needs a paid X API key.
