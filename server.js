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
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const API_BASE_URL = 'https://api.twelvedata.com';
const ALPHA_VANTAGE_BASE_URL = 'https://www.alphavantage.co/query';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const configuredRefreshSeconds = Number(process.env.MARKET_DATA_REFRESH_SECONDS || 60);
const CONFIGURED_REFRESH_SECONDS = Number.isFinite(configuredRefreshSeconds)
  ? Math.min(3600, Math.max(30, Math.floor(configuredRefreshSeconds)))
  : 60;
const ALPHA_VANTAGE_REFRESH_SECONDS = 6 * 60 * 60;
const configuredWatchlist = (process.env.NSE_WATCHLIST || 'RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK')
  .split(',')
  .map((symbol) => symbol.trim().toUpperCase())
  .filter((symbol) => /^[A-Z0-9&.-]{1,20}$/.test(symbol));
const WATCHLIST = [...new Set(configuredWatchlist)].slice(0, 6);
if (WATCHLIST.length === 0) {
  WATCHLIST.push('RELIANCE');
}
const CHART_SYMBOL = WATCHLIST[0] || 'RELIANCE';
let ALPHA_VANTAGE_SYMBOL_MAP = {};
if (process.env.ALPHA_VANTAGE_SYMBOL_MAP) {
  const parsedMap = JSON.parse(process.env.ALPHA_VANTAGE_SYMBOL_MAP);
  if (!parsedMap || Array.isArray(parsedMap) || typeof parsedMap !== 'object') {
    throw new Error('ALPHA_VANTAGE_SYMBOL_MAP must be a JSON object.');
  }
  for (const [symbol, mapping] of Object.entries(parsedMap)) {
    if (!/^[A-Z0-9&.-]{1,20}$/.test(symbol)
      || !mapping
      || typeof mapping.symbol !== 'string'
      || !mapping.symbol.trim()
      || mapping.exchange !== 'NSE'
      || mapping.currency !== 'INR') {
      throw new Error(`ALPHA_VANTAGE_SYMBOL_MAP has an invalid NSE/INR mapping for ${symbol}.`);
    }
    ALPHA_VANTAGE_SYMBOL_MAP[symbol] = mapping.symbol.trim();
  }
}
const HAS_COMPLETE_ALPHA_VANTAGE_MAPPING = WATCHLIST.every((symbol) => ALPHA_VANTAGE_SYMBOL_MAP[symbol]);
const REFRESH_SECONDS = !API_KEY && ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING
  ? Math.max(CONFIGURED_REFRESH_SECONDS, ALPHA_VANTAGE_REFRESH_SECONDS)
  : CONFIGURED_REFRESH_SECONDS;
const REFRESH_INTERVAL_MS = REFRESH_SECONDS * 1000;
const ALPHA_VANTAGE_REFRESH_INTERVAL_MS = ALPHA_VANTAGE_REFRESH_SECONDS * 1000;

const marketDataCache = new Map();
const refreshInProgress = new Map();
let cachedAlphaVantageQuotes = null;
let cachedAlphaVantageAt = 0;
let alphaVantageRefreshInProgress = null;

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
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    return null;
  }
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

async function fetchAlphaVantage(endpoint, params) {
  const url = new URL(ALPHA_VANTAGE_BASE_URL);
  Object.entries({ function: endpoint, ...params, apikey: ALPHA_VANTAGE_API_KEY }).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!response.ok) {
    throw new Error(`Alpha Vantage returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload.Note || payload.Information || payload['Error Message']) {
    throw new Error(payload.Note || payload.Information || payload['Error Message']);
  }
  return payload;
}

async function fetchAlphaVantageQuote(symbol) {
  const providerSymbol = ALPHA_VANTAGE_SYMBOL_MAP[symbol];
  if (!providerSymbol) {
    throw new Error(`Configure a verified NSE/INR Alpha Vantage symbol mapping for ${symbol}.`);
  }

  const payload = await fetchAlphaVantage('GLOBAL_QUOTE', { symbol: providerSymbol });
  const quote = payload['Global Quote'];
  const returnedSymbol = quote?.['01. symbol'];
  const price = parseNumber(quote?.['05. price']);
  const change = parseNumber(quote?.['09. change']);
  const percentChange = parseNumber(String(quote?.['10. change percent'] || '').replace(/%$/, ''));

  if (returnedSymbol !== providerSymbol
    || price === null
    || price <= 0
    || change === null
    || percentChange === null) {
    throw new Error(`Alpha Vantage did not return a complete quote for ${symbol}.`);
  }

  return {
    symbol,
    name: symbol,
    price,
    change,
    percentChange,
    currency: 'INR',
    timestamp: quote['07. latest trading day'] || null,
    marketOpen: null
  };
}

async function getAlphaVantageQuotes() {
  if (cachedAlphaVantageQuotes && Date.now() - cachedAlphaVantageAt < ALPHA_VANTAGE_REFRESH_INTERVAL_MS) {
    return cachedAlphaVantageQuotes;
  }
  if (!alphaVantageRefreshInProgress) {
    alphaVantageRefreshInProgress = Promise.allSettled(WATCHLIST.map(fetchAlphaVantageQuote))
      .then((results) => {
        const quotes = [];
        const errors = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            quotes.push(result.value);
          } else {
            errors.push(`${WATCHLIST[index]}: ${result.reason.message}`);
          }
        });
        const snapshot = { quotes, errors };
        cachedAlphaVantageQuotes = snapshot;
        cachedAlphaVantageAt = Date.now();
        return snapshot;
      })
      .finally(() => {
        alphaVantageRefreshInProgress = null;
      });
  }
  return alphaVantageRefreshInProgress;
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

async function buildYahooMarketData(chartSymbol = CHART_SYMBOL) {
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

    if (symbol === chartSymbol) {
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
    chartSymbol,
    chartSymbols: WATCHLIST,
    exchangeRate,
    errors,
    error: quotes.length === 0
      ? 'Yahoo Finance did not return NSE quotes. Check symbol availability or use an authorized market-data provider.'
      : null,
    disclaimer: 'Unofficial public Yahoo Finance data. Quote delays are unknown and real-time exchange data is not guaranteed.'
  };
}

async function buildTwelveDataMarketData(chartSymbol = CHART_SYMBOL) {
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
      symbol: chartSymbol,
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
    chartSymbol,
    chartSymbols: WATCHLIST,
    exchangeRate,
    errors: quoteErrors,
    error: quotes.length === 0
      ? 'No NSE quotes could be loaded. Check your API key, symbol access, and market-data subscription.'
      : null
  };
}

async function buildAlphaVantageMarketData(chartSymbol = CHART_SYMBOL) {
  if (!HAS_COMPLETE_ALPHA_VANTAGE_MAPPING) {
    throw new Error('Alpha Vantage requires an explicit NSE/INR symbol mapping for every configured watchlist symbol.');
  }
  const snapshot = await getAlphaVantageQuotes();
  if (snapshot.quotes.length !== WATCHLIST.length) {
    return {
      configured: true,
      source: 'alpha-vantage',
      provider: 'Alpha Vantage',
      currency: 'INR',
      exchange: 'NSE',
      refreshSeconds: REFRESH_SECONDS,
      updatedAt: new Date().toISOString(),
      quotes: snapshot.quotes,
      chart: [],
      chartSymbol,
      chartSymbols: WATCHLIST,
      exchangeRate: null,
      errors: snapshot.errors,
      error: 'Alpha Vantage did not return a complete quote for every configured watchlist symbol.'
    };
  }

  const chartResults = await Promise.allSettled([
    fetchYahooChart(`${chartSymbol}.NS`),
    fetchYahooChart('USDINR=X')
  ]);
  const chart = chartResults[0].status === 'fulfilled' ? getYahooPoints(chartResults[0].value) : [];
  const exchangeRate = chartResults[1].status === 'fulfilled'
    ? parseNumber(chartResults[1].value.meta?.regularMarketPrice)
    : null;
  const errors = [];
  if (chartResults[0].status === 'rejected') errors.push(`Chart: ${chartResults[0].reason.message}`);
  if (chartResults[1].status === 'rejected') errors.push(`USD/INR: ${chartResults[1].reason.message}`);

  return {
    configured: true,
    source: 'alpha-vantage',
    provider: 'Alpha Vantage quotes · Yahoo Finance chart/FX',
    currency: 'INR',
    exchange: 'NSE',
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes: snapshot.quotes,
    chart,
    chartSymbol,
    chartSymbols: WATCHLIST,
    exchangeRate,
    errors,
    disclaimer: 'Alpha Vantage quote snapshots may be delayed and depend on symbol/plan coverage. Intraday chart and USD/INR data use the unofficial Yahoo Finance feed. Verify exchange coverage and entitlements; real-time NSE data is not guaranteed.'
  };
}

async function buildMarketData(chartSymbol = CHART_SYMBOL) {
  const providerErrors = [];

  if (API_KEY) {
    try {
      const data = await buildTwelveDataMarketData(chartSymbol);
      if (data.quotes.length > 0) return data;
      throw new Error(data.error || 'Twelve Data returned no valid quotes.');
    } catch (error) {
      providerErrors.push(`Twelve Data unavailable: ${error.message}`);
    }
  }

  if (ALPHA_VANTAGE_API_KEY) {
    try {
      const data = await buildAlphaVantageMarketData(chartSymbol);
      if (data.quotes.length > 0 && data.quotes.length === WATCHLIST.length) {
        data.errors.unshift(...providerErrors);
        return data;
      }
      providerErrors.push(`Alpha Vantage unavailable: ${data.error || 'No complete NSE watchlist quotes were returned.'}`);
    } catch (error) {
      providerErrors.push(`Alpha Vantage unavailable: ${error.message}`);
    }
  }

  const fallback = await buildYahooMarketData(chartSymbol);
  fallback.errors.unshift(...providerErrors);
  return fallback;
}

async function getMarketData(chartSymbol = CHART_SYMBOL) {
  if (chartSymbol !== CHART_SYMBOL && !WATCHLIST.includes(chartSymbol)) {
    throw new Error('Requested chart symbol is not in the configured NSE watchlist.');
  }
  const cached = marketDataCache.get(chartSymbol);
  if (cached && Date.now() - cached.cachedAt < REFRESH_INTERVAL_MS) return cached.data;
  if (!refreshInProgress.has(chartSymbol)) {
    const request = buildMarketData(chartSymbol)
      .then((data) => {
        marketDataCache.set(chartSymbol, { data, cachedAt: Date.now() });
        return data;
      })
      .finally(() => {
        if (refreshInProgress.get(chartSymbol) === request) refreshInProgress.delete(chartSymbol);
      });
    refreshInProgress.set(chartSymbol, request);
  }
  return refreshInProgress.get(chartSymbol);
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
    provider: API_KEY
      ? ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING
        ? 'Twelve Data, Alpha Vantage, and Yahoo Finance fallback'
        : 'Twelve Data with Yahoo Finance fallback'
      : ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING
        ? 'Alpha Vantage quotes with Yahoo Finance chart/FX and fallback'
        : 'Yahoo Finance (unofficial)',
    mode: API_KEY
      ? ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING
        ? 'twelvedata-alpha-vantage-yahoo-fallback'
        : 'twelvedata-yahoo-fallback'
      : ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING
        ? 'alpha-vantage-yahoo-fallback'
        : 'yahoo-finance-unofficial',
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
  const requestedSymbol = typeof _req.query.symbol === 'string'
    ? _req.query.symbol.trim().toUpperCase()
    : CHART_SYMBOL;
  if (!WATCHLIST.includes(requestedSymbol)) {
    return res.status(400).json({ error: 'Choose a chart symbol from the configured NSE watchlist.' });
  }

  try {
    res.json(await getMarketData(requestedSymbol));
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
    console.log(`Data mode: ${API_KEY ? 'Twelve Data provider configured' : ALPHA_VANTAGE_API_KEY && HAS_COMPLETE_ALPHA_VANTAGE_MAPPING ? 'Alpha Vantage mappings configured' : 'Yahoo Finance fallback'}`);
    console.log(`Trusted proxy hops: ${TRUST_PROXY_HOPS}`);
  });
}

module.exports = {
  app,
  buildMarketData,
  buildAlphaVantageMarketData,
  buildTwelveDataMarketData,
  buildYahooMarketData,
  fetchAlphaVantageQuote,
  createCorsMiddleware,
  createRateLimiter,
  fetchAlphaVantageQuote,
  getMarketData
};
