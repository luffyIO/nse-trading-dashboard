# Indian Market Dashboard

Local dashboard for NSE equities and the USD/INR exchange rate. By default it uses Yahoo Finance's public chart endpoint as a free, unofficial data source; optionally, it uses Twelve Data when an API key is configured and falls back to Yahoo if that provider fails. It is read-only and does not place trades or connect to a brokerage account.

## Setup

1. Install and start the app for free Yahoo Finance data:

```powershell
cd "C:\Users\mail2\Downloads\Trading Bot"
npm install
npm start
```

Open [http://localhost:3000/](http://localhost:3000/).

## Desktop app

The desktop app bundles the dashboard and starts its Node API on a local loopback port. Market data still requires an internet connection and uses the same Yahoo Finance fallback or optional Twelve Data configuration described below. Theme choice and the adaptive agent's history stay in the local desktop app profile; they are not uploaded to the hosting service.

To run the desktop app from source:

```powershell
npm install
npm run desktop
```

To build an installer on its matching operating system:

```powershell
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Installers are written to `release/`:

- Windows: x64 NSIS `.exe` setup with desktop and Start Menu shortcuts.
- macOS: universal `.dmg` for Apple Silicon and Intel Macs.
- Linux: x64 `.AppImage` and Debian `.deb` packages.

The cross-platform GitHub Actions workflow builds each installer on its native runner. Run it manually to download workflow artifacts, or push a `v*` tag to publish a GitHub Release. These builds are currently unsigned: Windows may show SmartScreen warnings, and macOS may require the user to approve an app from an unidentified developer. Signing/notarization credentials are not included. The desktop app is a client for the market-data sources, not a broker or trade execution program.

The dashboard adds saved dark/light themes and sortable watchlist columns (symbol, price, daily change, and update time). Sorting changes only the display order and does not affect quote values or strategy calculations.

Optional: configure Twelve Data as the primary source. Create an account and API key at [twelvedata.com](https://twelvedata.com/), then copy `.env.example` to `.env` and set `TWELVE_DATA_API_KEY`. Confirm the plan grants access to NSE symbols and real-time data if required; exchange entitlements and latency depend on your subscription.

Example `.env`:

```env
TWELVE_DATA_API_KEY=your_api_key
NSE_WATCHLIST=RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK
MARKET_DATA_REFRESH_SECONDS=60
PORT=3000
```

`NSE_WATCHLIST` accepts up to six comma-separated NSE ticker symbols. The chart follows the first symbol. `MARKET_DATA_REFRESH_SECONDS` controls caching and polling; the minimum is 30 seconds. The no-key Yahoo mode fetches 1-day/5-minute chart data for each symbol and `USDINR=X`. Yahoo's public chart endpoint is unofficial, can change or rate-limit requests, and does not promise real-time prices; the UI labels this feed accordingly. Review Yahoo's applicable terms and do not redistribute the data. Do not treat it as an exchange-authorized real-time feed.

If Yahoo or Twelve Data is unavailable, the dashboard shows a clear unavailable state; it does not substitute invented prices. Do not commit `.env` or expose provider credentials in browser code.

## Data and limitations

- Free fallback: Yahoo Finance's public chart endpoint (`.NS` NSE symbols and `USDINR=X`). It is unofficial and has no real-time guarantee or availability SLA.
- Optional primary source: Twelve Data for NSE quotes, five-minute bars, and USD/INR; plan permissions, rate limits, and exchange entitlement charges may apply.
- Refresh defaults to 60 seconds; polling more often does not make an upstream feed real-time.
- Yahoo Finance does not provide authoritative NSE session state here, so session status remains unknown.
- Dhan's official API documentation states that Data APIs have additional charges; do not assume broker API access means free live market data.
- The dashboard is informational only, not a trading signal service, broker connection, or execution system.

## Comparable project review

The public [Swarajbabu/STOCK_MARKET](https://github.com/Swarajbabu/STOCK_MARKET) project was cloned and reviewed as a feature reference for market dashboards. It describes charts, market movers, theme switching, and saved chat. It does not provide a license file, so no code or assets from it were copied; this project independently implements its theme and market-mover sorting features. Chat was not added because conversational stock analysis is outside the dashboard's current verified market-data and paper-research scope.

## Public deployment (GitHub Pages + Render API)

GitHub Pages can host the static dashboard but cannot run its Node API. This repository includes a Render Blueprint (`render.yaml`) for the backend and a GitHub Actions workflow for building and deploying the static site.

1. Push this project to a GitHub repository you control. Connect that repository to Render and deploy the Blueprint. The Render service URL can host both the dashboard and API directly; GitHub Pages is optional if you want a separate frontend domain. The free Render service may sleep when idle and take time to wake.
2. In Render's service environment, set `CORS_ALLOWED_ORIGINS` to the exact Pages origin, for example `https://OWNER.github.io` (no path or trailing slash). Leave `TWELVE_DATA_API_KEY` unset or empty for best-effort Yahoo data; if used, add the key only to Render's secret environment, never to GitHub Pages.
3. Wait for the Render service to deploy. Confirm `https://YOUR-API.onrender.com/api/health` responds, then set the GitHub repository variable `MARKET_API_BASE_URL` to `https://YOUR-API.onrender.com`.
4. In the repository's Pages settings, choose GitHub Actions as the build/deploy source. Push to `main` or run the “Deploy dashboard to GitHub Pages” workflow manually.

The Pages build fails if `MARKET_API_BASE_URL` is missing or is not HTTPS. The backend only grants browser CORS access to origins explicitly listed in `CORS_ALLOWED_ORIGINS`; public API routes are also rate-limited, and only dashboard assets are served from the backend. Never put provider secrets in repository variables, frontend configuration, or committed files. This setup prepares deployment but does not create hosting accounts, repositories, credentials, or provider entitlements.

## Strategy lab limitations

The dashboard includes two illustrative, long-only simulations: EMA 9/21 trend following and RSI 14 oversold mean reversion. Strategy cards show a compact result first; expand a card to view its rules, full metrics, and sample period. Their metrics are calculated from the selected symbol's currently available 5-minute close series, not a multi-year or independently validated history. A signal is evaluated on a completed bar and modeled at the next available close. The estimate deducts 0.10% per entry/exit fill, but does not model slippage, taxes, liquidity, corporate actions, or market impact. Few trades, short history, missing bars, and parameter selection can make the displayed results misleading; the interface labels very small samples.

The forward-looking panel is a rules-based EMA/RSI condition summary, not a machine-learning forecast. It does not provide a price target, probability of profit, or individualized recommendation. Backtested and heuristic results are hypothetical and cannot assure future returns.

## Adaptive paper agent

The experimental adaptive agent follows an observe/train/holdout-check/repeat loop inspired by the idea in [Lewis Jackson Investing's video](https://www.youtube.com/watch?v=6njREUQAFdg). The video's transcript was unavailable during implementation, so this is an independent, explainable implementation—not a reproduction of its code or claims.

The browser stores up to 1,200 completed chart bars per symbol in local storage. Once at least 240 bars are available, it searches a small fixed set of EMA crossover periods across three chronological walk-forward windows in the earlier 80% of history, scoring average simulated net return minus half average maximum drawdown. It then evaluates the selected pair only once on the final 20% holdout and compares that result against cost-adjusted buy-and-hold. A paper setup is suppressed unless the holdout has at least three trades, positive net return, outperforms the benchmark, has drawdown at or below 15%, and current price/EMA/RSI conditions align. Sparse data remains in “collecting” or “wait” status rather than inventing a setup.

This is not a self-modifying neural network or an execution bot. It does not submit orders or connect to brokers. The holdout will eventually become part of training as new bars arrive, so repeated evaluations are not independent and do not guarantee improvement or profit. The 1,200-bar cap, repeated holdout checks, limited feed history, delayed data, close-only fills, and omitted market costs remain important limitations. Clearing browser storage resets the accumulated history.

## API endpoints

- `GET /api/health` — selected provider mode and watchlist
- `GET /api/status` — current primary instrument status
- `GET /api/market-data` — stock watchlist, chart series, and USD/INR
