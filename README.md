# Indian Market Dashboard

Responsive NSE dashboard with a private, persistent market chat, watchlist movers, selectable intraday charts, dark/light themes, and an educational paper-strategy lab. It can use Twelve Data, a carefully mapped Alpha Vantage quote feed, or Yahoo Finance's public chart endpoint as a free, unofficial fallback. It is read-only and does not place trades or connect to a brokerage account.

## Features

- **Market assistant:** Local, chat-style summaries of loaded quotes, watchlist gainers, and the selected chart. History is kept in this browser's local storage; messages are not sent to an AI service.
- **Watchlist gainers:** Highlights positive daily performers within the configured watchlist (not the whole NSE).
- **Selectable intraday chart:** Switch the existing custom SVG 5-minute chart between configured NSE symbols.
- **Market data providers:** Optional Twelve Data and Alpha Vantage quote support with Yahoo Finance fallback. Data availability and delay depend on provider and account entitlements; no real-time guarantee is made.
- **Saved themes and conversations:** Dark/light theme and chat history persist on the device.
- **Responsive accessible UI:** Keyboard-operable controls and layouts for desktop and mobile.
- **No fabricated prices:** Provider failures are shown as unavailable rather than replaced with synthetic quotes.
- **Paper-only research:** Strategy lab and adaptive paper agent do not submit orders or connect to a broker.

## Setup

1. Install and start the app for free Yahoo Finance data:

```powershell
cd "C:\Users\mail2\Downloads\Trading Bot"
npm install
npm start
```

Open [http://localhost:3000/](http://localhost:3000/).

## Desktop app

The desktop app bundles the dashboard and starts its Node API on a local loopback port. Market data still requires an internet connection and uses the same Yahoo Finance fallback or optional Twelve Data/verified Alpha Vantage configuration described below. Theme choice, the adaptive agent's history, and assistant chat stay in the local desktop app profile; they are not uploaded to the hosting service.

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
ALPHA_VANTAGE_API_KEY=
ALPHA_VANTAGE_SYMBOL_MAP=
NSE_WATCHLIST=RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK
MARKET_DATA_REFRESH_SECONDS=60
PORT=3000
```

`NSE_WATCHLIST` accepts up to six comma-separated NSE ticker symbols. The chart defaults to the first symbol, and can be changed in the dashboard. `MARKET_DATA_REFRESH_SECONDS` controls normal caching and polling; the minimum is 30 seconds. When Alpha Vantage is used as the primary quote provider, the dashboard refreshes its quote snapshot no more frequently than every six hours to limit free-tier requests (six symbols × four updates = 24 requests/day). Alpha Vantage does not identify exchange/currency in its quote response, so the optional `ALPHA_VANTAGE_SYMBOL_MAP` must explicitly map every watchlist symbol to a provider symbol that you have independently verified as NSE-listed and INR-denominated. For example, each JSON value must have `{"symbol":"<verified provider ticker>","exchange":"NSE","currency":"INR"}`. Do not infer this mapping from a matching ticker name. Alpha Vantage does not provide the dashboard's chart or FX data in this configuration.

Yahoo's public chart endpoint supplies the fallback quotes, 1-day/5-minute bars, and USD/INR rate. It is unofficial, can change or rate-limit requests, and does not promise real-time prices. Review Yahoo's applicable terms and do not redistribute the data. Do not treat it as an exchange-authorized real-time feed.

If configured providers and Yahoo are unavailable, the dashboard shows a clear unavailable state; it does not substitute invented prices. Do not commit `.env` or expose provider credentials in browser code.

## Data and limitations

- Free fallback: Yahoo Finance's public chart endpoint (`.NS` NSE symbols and `USDINR=X`). It is unofficial and has no real-time guarantee or availability SLA.
- Optional primary source: Twelve Data for NSE quotes, five-minute bars, and USD/INR; plan permissions, rate limits, and exchange entitlement charges may apply.
- Optional mapped quote source: Alpha Vantage's `GLOBAL_QUOTE` snapshots, only when every watchlist ticker has an operator-verified symbol mapping. Its quote response itself does not verify NSE exchange or INR currency. The dashboard therefore requires explicit mapping declarations and still makes no real-time claim.
- Refresh defaults to 60 seconds for the normal feed; the Alpha Vantage-only quote snapshot is cached for six hours. Polling more often does not make an upstream feed real-time.
- Yahoo Finance does not provide authoritative NSE session state here, so session status remains unknown.
- Dhan's official API documentation states that Data APIs have additional charges; do not assume broker API access means free live market data.
- The dashboard is informational only, not a trading signal service, broker connection, or execution system.

## Comparable project review

The public [Swarajbabu/STOCK_MARKET](https://github.com/Swarajbabu/STOCK_MARKET) project was reviewed as a feature reference for market dashboards. It describes charts, market movers, theme switching, and saved chat. It does not provide a license file, so no code or assets from it were copied; this project independently implements those user-facing ideas.

## Public deployment (GitHub Pages + Render API)

GitHub Pages can host the static dashboard but cannot run its Node API. This repository includes a Render Blueprint (`render.yaml`) for the backend and a GitHub Actions workflow for building and deploying the static site.

1. Push this project to a GitHub repository you control. Connect that repository to Render and deploy the Blueprint. The Render service URL can host both the dashboard and API directly; GitHub Pages is optional if you want a separate frontend domain. The free Render service may sleep when idle and take time to wake.
2. In Render's service environment, set `CORS_ALLOWED_ORIGINS` to the exact Pages origin, for example `https://OWNER.github.io` (no path or trailing slash). Leave provider keys unset for best-effort Yahoo data; if used, add keys and the Alpha Vantage symbol map only to Render's secret environment, never to GitHub Pages.
3. Wait for the Render service to deploy. Confirm `https://YOUR-API.onrender.com/api/health` responds, then set the GitHub repository variable `MARKET_API_BASE_URL` to `https://YOUR-API.onrender.com`.
4. In the repository's Pages settings, choose GitHub Actions as the build/deploy source. Push to `main` or run the “Deploy dashboard to GitHub Pages” workflow manually.

The Pages build fails if `MARKET_API_BASE_URL` is missing or is not HTTPS. The backend only grants browser CORS access to origins explicitly listed in `CORS_ALLOWED_ORIGINS`; public API routes are also rate-limited, and only dashboard assets are served from the backend. Never put provider secrets in repository variables, frontend configuration, or committed files. This setup prepares deployment but does not create hosting accounts, repositories, credentials, or provider entitlements.

## Oracle Cloud ARM self-hosting (Docker)

The companion Docker deployment can run on a Linux ARM64 instance, including an Oracle Cloud Ampere A1 VM where available. Oracle's advertised Always Free capacity, limits, and eligibility can change; ARM capacity may be unavailable in some regions. This guide does not create an Oracle account or guarantee free capacity.

1. Provision an ARM64 Ubuntu VM, assign a public IP, and configure its network security list/NSG and host firewall to allow inbound TCP ports 80 and 443. Restrict SSH (TCP 22) to your own IP. Point a DNS `A` record for a domain you control to the VM's public IP; Caddy uses that domain to obtain and renew TLS certificates.
2. Install Docker Engine and its Compose plugin using Docker's official instructions for your Ubuntu release. Clone this repository on the VM and enter its directory.
3. Create and secure the environment file:

   ```sh
   cp .env.oracle.example .env
   chmod 600 .env
   ```

   Edit `.env` and set `DOMAIN` to the DNS name from step 1. Add provider keys only if needed. If using Alpha Vantage, add a complete verified NSE/INR symbol map as described above.
4. Start and verify the HTTPS service:

   ```sh
   docker compose up -d --build
   docker compose ps
   curl --fail https://YOUR-DOMAIN/api/health
   ```

   Replace `YOUR-DOMAIN` with the configured host name. Caddy manages TLS certificate storage in Docker volumes. The app container is not directly published to the internet.
5. To update later, pull the desired repository revision and run `docker compose up -d --build`. Back up the `.env` file and `caddy_data` volume securely; never include secrets in a public image or commit.

The Docker setup is ARM-compatible and terminates HTTPS with Caddy, but the stock feed's exchange coverage, delay, rate limits, and service availability still depend on the chosen data providers. Oracle free-tier resources may be reclaimed or unavailable under Oracle's terms; monitor the instance and keep a separate backup.

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
