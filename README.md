# Indian Market Dashboard

Responsive NSE and BSE dashboard with selectable market-data providers, a private market chat that can create and backtest EMA strategies, exchange-specific watchlists, selectable intraday charts, an indicative USD/INR converter, dark/light themes, and an educational paper-strategy lab. It supports Twelve Data, mapped Alpha Vantage quotes, Yahoo Finance's unofficial fallback, and server-configured custom REST providers. It is read-only and does not place trades or connect to a brokerage account.

## Features

- **Market assistant:** Local, chat-style summaries plus commands to add, update, list, and backtest paper-only EMA strategies. Results are computed from the currently available historical chart bars and saved in this browser; messages are not sent to an AI service.
- **Watchlist gainers:** Highlights positive daily performers within the configured watchlist (not the whole NSE).
- **NSE and BSE watchlists:** Switch exchanges; quote and chart symbols are requested for the selected exchange.
- **Selectable intraday chart:** Switch the existing custom SVG 5-minute chart between configured symbols for the selected exchange.
- **USD/INR reference and converter:** Displays the configured provider's FX quote timestamp when available and calculates an indicative conversion locally. It is not a guaranteed live or executable exchange rate.
- **Selectable market data providers:** Choose auto, a configured built-in source, or a server-configured custom provider. Provider credentials stay on the API server. Timestamps, exchange access, and real-time availability depend on the provider and account; no real-time guarantee is made.
- **Saved themes and conversations:** Dark/light theme and chat history persist on the device.
- **Simplified dashboard:** Exchange selection and key market data stay prominent; provider settings, top gainers, and the optional strategy lab are available when needed.
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

### Android app

The Android wrapper packages the dashboard locally and connects to the configured HTTPS market-data API. It requires internet access; the APK does not contain a market-data server or provider credentials. To build locally, install JDK 21 or later and the Android SDK, configure `ANDROID_HOME` or `ANDROID_SDK_ROOT`, and set `MARKET_API_BASE_URL` to the deployed HTTPS API origin:

```powershell
$env:MARKET_API_BASE_URL = "https://your-market-api.example.com"
npm run build:android
```

The installable debug-signed APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The Render blueprint allows the GitHub Pages site and Capacitor's `https://localhost` WebView origin by default; add any custom hosting origin to `CORS_ALLOWED_ORIGINS`. The APK is intended for direct installation/testing; it is not signed with a Play Store release key.

The GitHub Actions workflow builds Windows, macOS, Linux, and Android installers. Set the repository Actions variable `MARKET_API_BASE_URL` to the deployed HTTPS API origin before running the workflow. Run it manually to download workflow artifacts, or push a `v*` tag to publish all successful installer artifacts in a GitHub Release. Desktop builds are unsigned: Windows may show SmartScreen warnings, and macOS may require approval for an app from an unidentified developer. Signing/notarization credentials are not included. The desktop and Android apps are clients for market-data sources, not brokers or trade-execution programs.

The dashboard adds saved dark/light themes and sortable watchlist columns (symbol, price, daily change, and update time). Sorting changes only the display order and does not affect quote values or strategy calculations.

Optional: configure Twelve Data as the primary source. Create an account and API key at [twelvedata.com](https://twelvedata.com/), then copy `.env.example` to `.env` and set `TWELVE_DATA_API_KEY`. Confirm the plan grants access to the selected NSE or BSE symbols and the data freshness you need; exchange entitlements and latency depend on your subscription.

Example `.env`:

```env
TWELVE_DATA_API_KEY=your_api_key
ALPHA_VANTAGE_API_KEY=
ALPHA_VANTAGE_SYMBOL_MAP=
CUSTOM_MARKET_DATA_PROVIDERS=
CUSTOM_MARKET_DATA_API_KEY=
NSE_WATCHLIST=RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK
BSE_WATCHLIST=RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK
MARKET_DATA_REFRESH_SECONDS=60
PORT=3000
```

`NSE_WATCHLIST` and `BSE_WATCHLIST` each accept up to six comma-separated symbols listed on that exchange. The chart defaults to the first symbol in the selected market; change the exchange and chart symbol in the dashboard. Confirm every symbol is available through the selected provider and exchange. `MARKET_DATA_REFRESH_SECONDS` controls the API cache and browser polling; the minimum is 30 seconds. The configured FX quote is refreshed at this interval when the provider responds, but the upstream timestamp, latency, market hours, and entitlement are provider-dependent. No source is guaranteed to deliver a real-time or executable USD/INR rate.

### Provider selection and custom APIs

The **Data provider** menu lists built-in providers and custom providers configured on the API server. **Auto** keeps the existing configured-source fallback order. Choosing a specific provider disables fallback for that request, so provider errors are visible instead of silently switching feeds.

There is no universal stock-market API schema. To add a REST provider, configure its HTTPS base URL, endpoint paths, response-field mappings, and authentication on the server in `CUSTOM_MARKET_DATA_PROVIDERS`; set credentials in the environment variable named by `apiKeyEnv`. The dashboard only receives the provider's display name and availability, never its credentials. This intentionally avoids entering API secrets into a public webpage. Custom endpoint paths must remain on the configured host; redirects are rejected. Only use a provider and symbols your account is entitled to access.

Example profile (replace the base URL and JSON field paths with those documented by your provider):

```json
[
  {
    "id": "broker-feed",
    "name": "Broker Market API",
    "baseUrl": "https://api.example.com/v1/",
    "apiKeyEnv": "CUSTOM_MARKET_DATA_API_KEY",
    "auth": { "type": "bearer" },
    "quote": {
      "path": "/quotes",
      "symbolParam": "symbol",
      "exchangeParam": "exchange",
      "fields": {
        "price": "data.price",
        "change": "data.change",
        "percentChange": "data.changePercent",
        "currency": "data.currency",
        "exchange": "data.exchange",
        "timestamp": "data.timestamp",
        "marketOpen": "data.marketOpen"
      }
    },
    "chart": {
      "path": "/candles",
      "symbolParam": "symbol",
      "exchangeParam": "exchange",
      "intervalParam": "interval",
      "interval": "5min",
      "pointsPath": "data.candles",
      "timeField": "time",
      "closeField": "close"
    },
    "fx": {
      "path": "/fx",
      "symbolParam": "pair",
      "symbol": "USD/INR",
      "fields": { "rate": "data.rate", "timestamp": "data.timestamp" }
    }
  }
]
```

Set that JSON as `CUSTOM_MARKET_DATA_PROVIDERS` and set `CUSTOM_MARKET_DATA_API_KEY` on the same server. Quote field mappings must confirm INR and the exchange (through response fields, a requested exchange parameter, or a fixed exchange setting). `auth.type` can be `bearer`, `header` (with a header `name`), `query` (with a query `name`), or `none`. `quote` is required; `chart` and `fx` are optional. Mapped JSON paths use dot notation. If chart history or a timestamp is unavailable, the dashboard shows it as unavailable rather than generating data. After configuration, select the provider from the dashboard menu. The generic adapter covers REST APIs that can be mapped to this contract; provider-specific OAuth, signed requests, WebSockets, and non-JSON protocols need a dedicated server adapter.

Polling is not proof of real-time delivery. The dashboard identifies the provider timestamp when supplied, shows the fetch time separately, and does not claim that any provider is live or exchange-authorized. Availability, latency, licensing, symbol coverage, and market-data rights remain the provider/account holder's responsibility.

When Alpha Vantage is used, quote snapshots are cached for six hours to limit requests. Alpha Vantage does not identify exchange/currency in its quote response, so every configured symbol needs an operator-verified mapping to its actual provider ticker, exchange, and INR denomination. An unprefixed key maps NSE by default; prefix keys with `BSE:` when the same ticker needs a separate BSE mapping, for example `{"RELIANCE":{"symbol":"<verified NSE ticker>","exchange":"NSE","currency":"INR"},"BSE:RELIANCE":{"symbol":"<verified BSE ticker>","exchange":"BSE","currency":"INR"}}`. Do not infer exchange coverage from a matching ticker name. Alpha Vantage does not supply the dashboard chart or FX quote in this setup.

Yahoo's public chart endpoint supplies fallback quotes (`.NS` for NSE and `.BO` for BSE), 1-day/5-minute bars, and a USD/INR reference quote. It is unofficial, can change or rate-limit requests, and does not promise real-time prices or conversion rates. Review Yahoo's applicable terms and do not redistribute the data. Do not treat it as an exchange-authorized real-time feed.

If configured providers and Yahoo are unavailable, the dashboard shows a clear unavailable state; it does not substitute invented prices. Do not commit `.env` or expose provider credentials in browser code.

## Data and limitations

- Free fallback: Yahoo Finance's public chart endpoint (`.NS` NSE, `.BO` BSE, and `USDINR=X`). It is unofficial and has no real-time guarantee or availability SLA.
- Optional primary source: Twelve Data for exchange-specific quotes and five-minute bars and a USD/INR reference rate; account permissions, rate limits, and exchange entitlements may apply separately to NSE and BSE.
- Optional mapped quote source: Alpha Vantage's `GLOBAL_QUOTE` snapshots, only when every selected watchlist ticker has an operator-verified symbol mapping. Its response does not itself verify exchange or currency. Quote snapshots are cached for six hours; chart and FX data use the unofficial Yahoo Finance feed.
- Custom REST providers can be registered using the generic JSON contract above. Credentials remain in server environment variables; a provider must supply and map valid INR prices and exchange data.
- The displayed USD/INR value is an indicative data-provider quote, not an assured live bank, broker, remittance, or executable conversion rate. Its timestamp may be missing or stale, and refresh polling does not control upstream freshness.
- Neither fallback feed provides authoritative exchange session state here, so session status remains unknown unless an entitled provider confirms it.
- Dhan's official API documentation states that Data APIs have additional charges; do not assume broker API access means free live market data.
- The dashboard is informational only, not a trading signal service, broker connection, or execution system.
- Chat-created EMA strategies are stored locally and tested against the currently available 5-minute history. Results include estimated fill costs but are not forecasts; limited intraday history, gaps, slippage, taxes, and market impact can materially change outcomes.

## Comparable project review

The public [Swarajbabu/STOCK_MARKET](https://github.com/Swarajbabu/STOCK_MARKET) project was reviewed as a feature reference for market dashboards. It describes charts, market movers, theme switching, and saved chat. It does not provide a license file, so no code or assets from it were copied; this project independently implements those user-facing ideas.

## Public deployment (GitHub Pages + Render API)

GitHub Pages can host the static dashboard but cannot run its Node API. This repository includes a Render Blueprint (`render.yaml`) for the backend and a GitHub Actions workflow for building and deploying the static site.

1. Push this project to a GitHub repository you control. Connect that repository to Render and deploy the Blueprint. The Render service URL can host both the dashboard and API directly; GitHub Pages is optional if you want a separate frontend domain. The free Render service may sleep when idle and take time to wake.
2. In Render's service environment, set `CORS_ALLOWED_ORIGINS` to the exact Pages origin, for example `https://OWNER.github.io` (no path or trailing slash). The API separately allows the bundled Android app's `https://localhost` origin. Leave provider keys unset for best-effort Yahoo data; if used, add keys and the Alpha Vantage symbol map only to Render's secret environment, never to GitHub Pages.
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

- `GET /api/health` — provider mode and NSE/BSE watchlists
- `GET /api/status?exchange=NSE|BSE` — selected market's primary instrument status
- `GET /api/market-data?exchange=NSE|BSE&symbol=SYMBOL` — selected exchange watchlist, chart series, and USD/INR reference quote
