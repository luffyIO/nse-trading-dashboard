const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
);
const configuredPort = Number(process.env.PORT || 3000);
const PORT = Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65535
  ? configuredPort
  : 3000;
const configuredProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
const TRUST_PROXY_HOPS = Number.isInteger(configuredProxyHops) && configuredProxyHops >= 0 && configuredProxyHops <= 5
  ? configuredProxyHops
  : 0;
const API_KEY = process.env.TWELVE_DATA_API_KEY;
const API_BASE_URL = 'https://api.twelvedata.com';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const configuredRefreshSeconds = Number(process.env.MARKET_DATA_REFRESH_SECONDS || 60);
const REFRESH_SECONDS = Number.isFinite(configuredRefreshSeconds)
  ? Math.min(3600, Math.max(30, Math.floor(configuredRefreshSeconds)))
  : 60;
const REFRESH_INTERVAL_MS = REFRESH_SECONDS * 1000;
const configuredWatchlist = (process.env.NSE_WATCHLIST || 'RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK')
  .split(',')
  .map((symbol) => symbol.trim().toUpperCase())
  .filter((symbol) => /^[A-Z0-9&.-]{1,20}$/.test(symbol));
const WATCHLIST = [...new Set(configuredWatchlist)].slice(0, 6);
if (WATCHLIST.length === 0) {
  WATCHLIST.push('RELIANCE');
}
const CHART_SYMBOL = WATCHLIST[0] || 'RELIANCE';

let cachedMarketData = null;
let cachedAt = 0;
let refreshInProgress = null;

app.set('trust proxy', TRUST_PROXY_HOPS);

function createCorsMiddleware(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.get('Origin');
    if (!origin) return next();

    res.vary('Origin');
    if (!allowedOrigins.has(origin)) {
      if (req.method === 'OPTIONS') return res.sendStatus(403);
      return next();
    }

    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    res.set('Access-Control-Max-Age', '600');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  };
}

function createRateLimiter({ windowMs, maxRequests }) {
  const requestsByIp = new Map();
  let lastCleanup = 0;

  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let entry = requestsByIp.get(ip);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      requestsByIp.set(ip, entry);
    }

    entry.count += 1;
    if (entry.count > maxRequests) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'Request limit reached. Try again shortly.' });
    }

    if (now - lastCleanup > windowMs) {
      for (const [address, requestEntry] of requestsByIp) {
        if (now >= requestEntry.resetAt) requestsByIp.delete(address);
      }
      lastCleanup = now;
    }
    return next();
  };
}

function sendPublicAsset(fileName) {
  return (_req, res, next) => {
    res.sendFile(path.join(__dirname, fileName), (error) => {
      if (error) next(error);
    });
  };
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchTwelveData(endpoint, params) {
  const url = new URL(endpoint, API_BASE_URL);
  Object.entries({ ...params, apikey: API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`Market data provider returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.status === 'error' || payload.code) {
    throw new Error(payload.message || 'Market data provider rejected the request');
  }
  return payload;
}

async function fetchQuote(symbol) {
  const quote = await fetchTwelveData('/quote', {
    symbol,
    exchange: 'NSE'
  });

  const price = parseNumber(quote.close);
  if (price === null) {
    throw new Error(`No quote price returned for ${symbol}`);
  }
  if (quote.currency && quote.currency !== 'INR') {
    throw new Error(`Expected INR data for ${symbol}, received ${quote.currency}`);
  }

  return {
    symbol,
    name: quote.name || symbol,
    price,
    change: parseNumber(quote.change),
    percentChange: parseNumber(quote.percent_change),
    currency: quote.currency || 'INR',
    timestamp: quote.datetime || null,
    marketOpen: quote.is_market_open === true || quote.is_market_open === 'true'
      ? true
      : quote.is_market_open === false || quote.is_market_open === 'false'
        ? false
        : null
  };
}

async function fetchYahooChart(symbol) {
  const url = new URL(encodeURIComponent(symbol), YAHOO_CHART_URL);
  url.searchParams.set('interval', '5m');
  url.searchParams.set('range', '1d');

  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 TradingDashboard/1.0' },
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) {
    throw new Error(`Yahoo Finance returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const chartResult = payload.chart?.result?.[0];
  if (payload.chart?.error || !chartResult) {
    throw new Error(payload.chart?.error?.description || `No chart data returned for ${symbol}`);
  }
  return chartResult;
}

function getYahooPoints(chartResult) {
  const timestamps = chartResult.timestamp || [];
  const closes = chartResult.indicators?.quote?.[0]?.close || [];
  return timestamps
    .map((timestamp, index) => ({
      time: new Date(timestamp * 1000).toISOString(),
      close: parseNumber(closes[index])
    }))
    .filter((point) => point.close !== null);
}

async function buildYahooMarketData() {
  const results = await Promise.allSettled([
    ...WATCHLIST.map((symbol) => fetchYahooChart(`${symbol}.NS`)),
    fetchYahooChart('USDINR=X')
  ]);
  const quoteResults = results.slice(0, WATCHLIST.length);
  const fxResult = results[WATCHLIST.length];
  const quotes = [];
  const errors = [];
  let chart = [];

  quoteResults.forEach((result, index) => {
    const symbol = WATCHLIST[index];
    if (result.status === 'rejected') {
      errors.push(`${symbol}: ${result.reason.message}`);
      return;
    }

    const meta = result.value.meta || {};
    const price = parseNumber(meta.regularMarketPrice);
    if (price === null || meta.currency !== 'INR') {
      errors.push(`${symbol}: Yahoo Finance did not return a valid INR quote.`);
      return;
    }

    const previousClose = parseNumber(meta.chartPreviousClose ?? meta.previousClose);
    const change = previousClose === null ? null : price - previousClose;
    const percentChange = previousClose === null || previousClose === 0
      ? null
      : (change / previousClose) * 100;
    const marketTimestamp = parseNumber(meta.regularMarketTime);

    quotes.push({
      symbol,
      name: meta.longName || meta.shortName || symbol,
      price,
      change,
      percentChange,
      currency: meta.currency,
      timestamp: marketTimestamp
        ? new Intl.DateTimeFormat('en-IN', {
          timeZone: 'Asia/Kolkata',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        }).format(new Date(marketTimestamp * 1000))
        : null,
      marketOpen: null
    });

    if (symbol === CHART_SYMBOL) {
      chart = getYahooPoints(result.value);
    }
  });

  const fxChart = fxResult.status === 'fulfilled' ? fxResult.value : null;
  const exchangeRate = fxChart ? parseNumber(fxChart.meta?.regularMarketPrice) : null;
  if (!fxChart) {
    errors.push(`USD/INR: ${fxResult.reason.message}`);
  }

  return {
    configured: true,
    source: 'yahoo-finance-unofficial',
    provider: 'Yahoo Finance (unofficial)',
    currency: 'INR',
    exchange: 'NSE',
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes,
    chart,
    chartSymbol: CHART_SYMBOL,
    exchangeRate,
    errors,
    error: quotes.length === 0
      ? 'Yahoo Finance did not return NSE quotes. Check symbol availability or use an authorized market-data provider.'
      : null,
    disclaimer: 'Unofficial public Yahoo Finance data. Quote delays are unknown and real-time exchange data is not guaranteed.'
  };
}

async function buildTwelveDataMarketData() {
  const quotesResult = await Promise.allSettled(WATCHLIST.map(fetchQuote));
  const quotes = quotesResult
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const quoteErrors = quotesResult
    .map((result, index) => result.status === 'rejected'
      ? `${WATCHLIST[index]}: ${result.reason.message}`
      : null)
    .filter(Boolean);

  const [chartResult, fxResult] = await Promise.allSettled([
    fetchTwelveData('/time_series', {
      symbol: CHART_SYMBOL,
      exchange: 'NSE',
      interval: '5min',
      outputsize: '100',
      order: 'ASC'
    }),
    fetchTwelveData('/exchange_rate', { symbol: 'USD/INR' })
  ]);

  let chart = null;
  if (chartResult.status === 'fulfilled' && Array.isArray(chartResult.value.values)) {
    chart = chartResult.value.values
      .map((point) => ({
        time: point.datetime,
        close: parseNumber(point.close)
      }))
      .filter((point) => point.close !== null);
  } else if (chartResult.status === 'rejected') {
    quoteErrors.push(`Chart: ${chartResult.reason.message}`);
  }

  let exchangeRate = null;
  if (fxResult.status === 'fulfilled') {
    exchangeRate = parseNumber(fxResult.value.rate);
  } else {
    quoteErrors.push(`USD/INR: ${fxResult.reason.message}`);
  }

  return {
    configured: true,
    source: 'twelvedata',
    provider: 'Twelve Data',
    currency: 'INR',
    exchange: 'NSE',
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes,
    chart: chart || [],
    chartSymbol: CHART_SYMBOL,
    exchangeRate,
    errors: quoteErrors,
    error: quotes.length === 0
      ? 'No NSE quotes could be loaded. Check your API key, symbol access, and market-data subscription.'
      : null
  };
}

async function buildMarketData() {
  if (!API_KEY) return buildYahooMarketData();

  try {
    const data = await buildTwelveDataMarketData();
    if (data.quotes.length > 0) return data;
    throw new Error(data.error || 'Twelve Data returned no valid quotes.');
  } catch (error) {
    const fallback = await buildYahooMarketData();
    fallback.errors.unshift(`Twelve Data unavailable: ${error.message}`);
    return fallback;
  }
}

async function getMarketData() {
  const isFresh = cachedMarketData && Date.now() - cachedAt < REFRESH_INTERVAL_MS;
  if (isFresh) return cachedMarketData;
  if (!refreshInProgress) {
    refreshInProgress = buildMarketData()
      .then((data) => {
        cachedMarketData = data;
        cachedAt = Date.now();
        return data;
      })
      .finally(() => {
        refreshInProgress = null;
      });
  }
  return refreshInProgress;
}

app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Frame-Options', 'DENY');
  res.set(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'"
  );
  next();
});

app.use(createCorsMiddleware(ALLOWED_ORIGINS));

app.get('/', sendPublicAsset('index.html'));
app.get('/index.html', sendPublicAsset('index.html'));
app.get('/styles.css', sendPublicAsset('styles.css'));
app.get('/script.js', sendPublicAsset('script.js'));
app.get('/strategy-engine.js', sendPublicAsset('strategy-engine.js'));
app.get('/config.js', sendPublicAsset('config.js'));

const apiRateLimiter = createRateLimiter({ windowMs: 60 * 1000, maxRequests: 30 });

app.get('/api/health', apiRateLimiter, (_req, res) => {
  res.json({
    ok: true,
    configured: true,
    provider: API_KEY ? 'Twelve Data with Yahoo Finance fallback' : 'Yahoo Finance (unofficial)',
    mode: API_KEY ? 'twelvedata-with-yahoo-fallback' : 'yahoo-finance-unofficial',
    exchange: 'NSE',
    currency: 'INR',
    symbols: WATCHLIST,
    refreshSeconds: REFRESH_SECONDS
  });
});

app.get('/api/status', apiRateLimiter, async (_req, res) => {
  try {
    const data = await getMarketData();
    const primaryQuote = data.quotes?.find((quote) => quote.symbol === CHART_SYMBOL);
    res.json({
      configured: data.configured,
      source: data.source,
      exchange: data.exchange,
      currency: data.currency,
      symbol: CHART_SYMBOL,
      market: 'UNKNOWN',
      marketOpen: primaryQuote?.marketOpen ?? null,
      lastPrice: primaryQuote?.price ?? null,
      change: primaryQuote?.change ?? null,
      percentChange: primaryQuote?.percentChange ?? null,
      exchangeRate: data.exchangeRate ?? null,
      updatedAt: data.updatedAt ?? null,
      error: data.error
    });
  } catch (error) {
    res.status(502).json({ error: `Unable to load NSE market status: ${error.message}` });
  }
});

app.get('/api/market-data', apiRateLimiter, async (_req, res) => {
  try {
    res.json(await getMarketData());
  } catch (error) {
    res.status(502).json({ error: `Unable to load NSE market data: ${error.message}` });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Indian market dashboard running at http://localhost:${PORT}`);
    console.log(`Data mode: ${API_KEY ? 'Twelve Data provider configured' : 'unconfigured (set TWELVE_DATA_API_KEY)'}`);
    console.log(`Trusted proxy hops: ${TRUST_PROXY_HOPS}`);
  });
}

module.exports = {
  app,
  buildMarketData,
  buildTwelveDataMarketData,
  buildYahooMarketData,
  createCorsMiddleware,
  createRateLimiter,
  getMarketData
};
