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
const EXCHANGES = ['NSE', 'BSE'];
const WATCHLISTS = Object.fromEntries(EXCHANGES.map((exchange) => {
  const configuredWatchlist = (process.env[`${exchange}_WATCHLIST`]
    || 'RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK')
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9&.-]{1,20}$/.test(symbol));
  return [exchange, [...new Set(configuredWatchlist)].slice(0, 6)];
}));
for (const exchange of EXCHANGES) {
  if (WATCHLISTS[exchange].length === 0) WATCHLISTS[exchange].push('RELIANCE');
}
const CHART_SYMBOLS = Object.fromEntries(EXCHANGES.map((exchange) => [exchange, WATCHLISTS[exchange][0]]));
const ALPHA_VANTAGE_SYMBOL_MAP = {};
if (process.env.ALPHA_VANTAGE_SYMBOL_MAP) {
  const parsedMap = JSON.parse(process.env.ALPHA_VANTAGE_SYMBOL_MAP);
  if (!parsedMap || Array.isArray(parsedMap) || typeof parsedMap !== 'object') {
    throw new Error('ALPHA_VANTAGE_SYMBOL_MAP must be a JSON object.');
  }
  for (const [mapKey, mapping] of Object.entries(parsedMap)) {
    const keyMatch = /^(?:(NSE|BSE):)?([A-Z0-9&.-]{1,20})$/.exec(mapKey);
    const symbol = keyMatch?.[2];
    const exchange = mapping?.exchange || keyMatch?.[1] || 'NSE';
    if (!symbol
      || !mapping
      || typeof mapping.symbol !== 'string'
      || !mapping.symbol.trim()
      || !EXCHANGES.includes(exchange)
      || (keyMatch?.[1] && mapping.exchange && keyMatch[1] !== mapping.exchange)
      || mapping.currency !== 'INR') {
      throw new Error(`ALPHA_VANTAGE_SYMBOL_MAP has an invalid exchange/INR mapping for ${mapKey}.`);
    }
    ALPHA_VANTAGE_SYMBOL_MAP[`${exchange}:${symbol}`] = mapping.symbol.trim();
  }
}
const REFRESH_SECONDS = CONFIGURED_REFRESH_SECONDS;
const REFRESH_INTERVAL_MS = REFRESH_SECONDS * 1000;
const ALPHA_VANTAGE_REFRESH_INTERVAL_MS = ALPHA_VANTAGE_REFRESH_SECONDS * 1000;

const marketDataCache = new Map();
const refreshInProgress = new Map();
const cachedAlphaVantageQuotes = new Map();
const alphaVantageRefreshInProgress = new Map();

function getWatchlist(exchange) {
  return WATCHLISTS[exchange];
}

function hasCompleteAlphaVantageMapping(exchange) {
  return getWatchlist(exchange).every((symbol) => ALPHA_VANTAGE_SYMBOL_MAP[`${exchange}:${symbol}`]);
}

function getExchangeChartSymbol(exchange) {
  return CHART_SYMBOLS[exchange];
}

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

function parseTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = parseNumber(value);
  const date = numeric === null
    ? new Date(value)
    : new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
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

async function fetchAlphaVantageQuote(symbol, exchange = 'NSE') {
  const providerSymbol = ALPHA_VANTAGE_SYMBOL_MAP[`${exchange}:${symbol}`];
  if (!providerSymbol) {
    throw new Error(`Configure a verified ${exchange}/INR Alpha Vantage symbol mapping for ${symbol}.`);
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
    throw new Error(`Alpha Vantage did not return a complete ${exchange} quote for ${symbol}.`);
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

async function getAlphaVantageQuotes(exchange) {
  const cached = cachedAlphaVantageQuotes.get(exchange);
  if (cached && Date.now() - cached.cachedAt < ALPHA_VANTAGE_REFRESH_INTERVAL_MS) {
    return cached.snapshot;
  }
  if (!alphaVantageRefreshInProgress.has(exchange)) {
    const watchlist = getWatchlist(exchange);
    const request = Promise.allSettled(watchlist.map((symbol) => fetchAlphaVantageQuote(symbol, exchange)))
      .then((results) => {
        const quotes = [];
        const errors = [];
        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            quotes.push(result.value);
          } else {
            errors.push(`${watchlist[index]}: ${result.reason.message}`);
          }
        });
        const snapshot = { quotes, errors };
        cachedAlphaVantageQuotes.set(exchange, { snapshot, cachedAt: Date.now() });
        return snapshot;
      })
      .finally(() => {
        if (alphaVantageRefreshInProgress.get(exchange) === request) {
          alphaVantageRefreshInProgress.delete(exchange);
        }
      });
    alphaVantageRefreshInProgress.set(exchange, request);
  }
  return alphaVantageRefreshInProgress.get(exchange);
}

async function fetchQuote(symbol, exchange) {
  const quote = await fetchTwelveData('/quote', {
    symbol,
    exchange
  });

  const price = parseNumber(quote.close);
  if (price === null) {
    throw new Error(`No quote price returned for ${symbol}`);
  }
  if (quote.currency && quote.currency !== 'INR') {
    throw new Error(`Expected INR data for ${symbol}, received ${quote.currency}`);
  }
  if (quote.exchange && quote.exchange.toUpperCase() !== exchange) {
    throw new Error(`Expected ${exchange} data for ${symbol}, received ${quote.exchange}`);
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

async function buildYahooMarketData(chartSymbol = getExchangeChartSymbol('NSE'), exchange = 'NSE') {
  const watchlist = getWatchlist(exchange);
  const suffix = exchange === 'BSE' ? '.BO' : '.NS';
  const results = await Promise.allSettled([
    ...watchlist.map((symbol) => fetchYahooChart(`${symbol}${suffix}`)),
    fetchYahooChart('USDINR=X')
  ]);
  const quoteResults = results.slice(0, watchlist.length);
  const fxResult = results[watchlist.length];
  const quotes = [];
  const errors = [];
  let chart = [];

  quoteResults.forEach((result, index) => {
    const symbol = watchlist[index];
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
  const exchangeRateUpdatedAt = fxChart
    ? parseTimestamp(fxChart.meta?.regularMarketTime)
    : null;
  if (!fxChart) {
    errors.push(`USD/INR: ${fxResult.reason.message}`);
  }

  return {
    configured: true,
    source: 'yahoo-finance-unofficial',
    provider: 'Yahoo Finance (unofficial)',
    currency: 'INR',
    exchange,
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes,
    chart,
    chartSymbol,
    chartSymbols: watchlist,
    exchangeRate,
    exchangeRateUpdatedAt,
    exchangeRateSource: 'Yahoo Finance (unofficial)',
    errors,
    error: quotes.length === 0
      ? `Yahoo Finance did not return ${exchange} quotes. Check symbol availability or use an authorized market-data provider.`
      : null,
    disclaimer: 'Unofficial public Yahoo Finance data. Quote delays are unknown and real-time exchange data is not guaranteed.'
  };
}

async function buildTwelveDataMarketData(chartSymbol = getExchangeChartSymbol('NSE'), exchange = 'NSE') {
  const watchlist = getWatchlist(exchange);
  const quotesResult = await Promise.allSettled(watchlist.map((symbol) => fetchQuote(symbol, exchange)));
  const quotes = quotesResult
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const quoteErrors = quotesResult
    .map((result, index) => result.status === 'rejected'
      ? `${watchlist[index]}: ${result.reason.message}`
      : null)
    .filter(Boolean);

  const [chartResult, fxResult] = await Promise.allSettled([
    fetchTwelveData('/time_series', {
      symbol: chartSymbol,
      exchange,
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
  let exchangeRateUpdatedAt = null;
  if (fxResult.status === 'fulfilled') {
    exchangeRate = parseNumber(fxResult.value.rate);
    exchangeRateUpdatedAt = parseTimestamp(fxResult.value.timestamp ?? fxResult.value.datetime);
  } else {
    quoteErrors.push(`USD/INR: ${fxResult.reason.message}`);
  }

  return {
    configured: true,
    source: 'twelvedata',
    provider: 'Twelve Data',
    currency: 'INR',
    exchange,
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes,
    chart: chart || [],
    chartSymbol,
    chartSymbols: watchlist,
    exchangeRate,
    exchangeRateUpdatedAt,
    exchangeRateSource: 'Twelve Data',
    errors: quoteErrors,
    error: quotes.length === 0
      ? `No ${exchange} quotes could be loaded. Check your API key, symbol access, and market-data subscription.`
      : null
  };
}

async function buildAlphaVantageMarketData(chartSymbol = getExchangeChartSymbol('NSE'), exchange = 'NSE') {
  const watchlist = getWatchlist(exchange);
  if (!hasCompleteAlphaVantageMapping(exchange)) {
    throw new Error(`Alpha Vantage requires an explicit ${exchange}/INR symbol mapping for every configured watchlist symbol.`);
  }
  const snapshot = await getAlphaVantageQuotes(exchange);
  if (snapshot.quotes.length !== watchlist.length) {
    return {
      configured: true,
      source: 'alpha-vantage',
      provider: 'Alpha Vantage',
      currency: 'INR',
      exchange,
      refreshSeconds: REFRESH_SECONDS,
      updatedAt: new Date().toISOString(),
      quotes: snapshot.quotes,
      chart: [],
      chartSymbol,
      chartSymbols: watchlist,
      exchangeRate: null,
      exchangeRateUpdatedAt: null,
      exchangeRateSource: null,
      errors: snapshot.errors,
      error: 'Alpha Vantage did not return a complete quote for every configured watchlist symbol.'
    };
  }

  const chartResults = await Promise.allSettled([
    fetchYahooChart(`${chartSymbol}${exchange === 'BSE' ? '.BO' : '.NS'}`),
    fetchYahooChart('USDINR=X')
  ]);
  const chart = chartResults[0].status === 'fulfilled' ? getYahooPoints(chartResults[0].value) : [];
  const fxChart = chartResults[1].status === 'fulfilled' ? chartResults[1].value : null;
  const exchangeRate = fxChart
    ? parseNumber(fxChart.meta?.regularMarketPrice)
    : null;
  const exchangeRateUpdatedAt = fxChart
    ? parseTimestamp(fxChart.meta?.regularMarketTime)
    : null;
  const errors = [];
  if (chartResults[0].status === 'rejected') errors.push(`Chart: ${chartResults[0].reason.message}`);
  if (chartResults[1].status === 'rejected') errors.push(`USD/INR: ${chartResults[1].reason.message}`);

  return {
    configured: true,
    source: 'alpha-vantage',
    provider: 'Alpha Vantage quotes · Yahoo Finance chart/FX',
    currency: 'INR',
    exchange,
    refreshSeconds: REFRESH_SECONDS,
    updatedAt: new Date().toISOString(),
    quotes: snapshot.quotes,
    chart,
    chartSymbol,
    chartSymbols: watchlist,
    exchangeRate,
    exchangeRateUpdatedAt,
    exchangeRateSource: 'Yahoo Finance (unofficial)',
    errors,
    disclaimer: 'Alpha Vantage quote snapshots may be delayed and depend on symbol/plan coverage. Intraday chart and USD/INR data use the unofficial Yahoo Finance feed. Verify exchange coverage and entitlements; real-time exchange data is not guaranteed.'
  };
}

async function buildMarketData(chartSymbol = getExchangeChartSymbol('NSE'), exchange = 'NSE') {
  const providerErrors = [];

  if (API_KEY) {
    try {
      const data = await buildTwelveDataMarketData(chartSymbol, exchange);
      if (data.quotes.length > 0) return data;
      throw new Error(data.error || 'Twelve Data returned no valid quotes.');
    } catch (error) {
      providerErrors.push(`Twelve Data unavailable: ${error.message}`);
    }
  }

  if (ALPHA_VANTAGE_API_KEY) {
    try {
      const data = await buildAlphaVantageMarketData(chartSymbol, exchange);
      if (data.quotes.length > 0 && data.quotes.length === getWatchlist(exchange).length) {
        data.errors.unshift(...providerErrors);
        return data;
      }
      providerErrors.push(`Alpha Vantage unavailable: ${data.error || `No complete ${exchange} watchlist quotes were returned.`}`);
    } catch (error) {
      providerErrors.push(`Alpha Vantage unavailable: ${error.message}`);
    }
  }

  const fallback = await buildYahooMarketData(chartSymbol, exchange);
  fallback.errors.unshift(...providerErrors);
  return fallback;
}

async function getMarketData(chartSymbol = getExchangeChartSymbol('NSE'), exchange = 'NSE') {
  if (!EXCHANGES.includes(exchange)) {
    throw new Error('Requested exchange is not supported.');
  }
  if (!getWatchlist(exchange).includes(chartSymbol)) {
    throw new Error(`Requested chart symbol is not in the configured ${exchange} watchlist.`);
  }
  const cacheKey = `${exchange}:${chartSymbol}`;
  const cached = marketDataCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REFRESH_INTERVAL_MS) return cached.data;
  if (!refreshInProgress.has(cacheKey)) {
    const request = buildMarketData(chartSymbol, exchange)
      .then((data) => {
        marketDataCache.set(cacheKey, { data, cachedAt: Date.now() });
        return data;
      })
      .finally(() => {
        if (refreshInProgress.get(cacheKey) === request) refreshInProgress.delete(cacheKey);
      });
    refreshInProgress.set(cacheKey, request);
  }
  return refreshInProgress.get(cacheKey);
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
      ? ALPHA_VANTAGE_API_KEY
        ? 'Twelve Data, Alpha Vantage, and Yahoo Finance fallback'
        : 'Twelve Data with Yahoo Finance fallback'
      : ALPHA_VANTAGE_API_KEY
        ? 'Alpha Vantage quotes with Yahoo Finance chart/FX fallback where mapped'
        : 'Yahoo Finance (unofficial)',
    mode: API_KEY
      ? ALPHA_VANTAGE_API_KEY
        ? 'twelvedata-alpha-vantage-yahoo-fallback'
        : 'twelvedata-yahoo-fallback'
      : ALPHA_VANTAGE_API_KEY
        ? 'alpha-vantage-yahoo-fallback-where-mapped'
        : 'yahoo-finance-unofficial',
    exchanges: EXCHANGES,
    exchange: 'NSE',
    currency: 'INR',
    symbols: WATCHLISTS.NSE,
    markets: Object.fromEntries(EXCHANGES.map((exchange) => [exchange, {
      symbols: getWatchlist(exchange),
      alphaVantageConfigured: Boolean(ALPHA_VANTAGE_API_KEY && hasCompleteAlphaVantageMapping(exchange))
    }])),
    refreshSeconds: REFRESH_SECONDS
  });
});

app.get('/api/status', apiRateLimiter, async (_req, res) => {
  const requestedExchange = typeof _req.query.exchange === 'string'
    ? _req.query.exchange.trim().toUpperCase()
    : 'NSE';
  if (!EXCHANGES.includes(requestedExchange)) {
    return res.status(400).json({ error: 'Choose NSE or BSE.' });
  }

  try {
    const data = await getMarketData(getExchangeChartSymbol(requestedExchange), requestedExchange);
    const primaryQuote = data.quotes?.find((quote) => quote.symbol === getExchangeChartSymbol(requestedExchange));
    res.json({
      configured: data.configured,
      source: data.source,
      exchange: data.exchange,
      currency: data.currency,
      symbol: getExchangeChartSymbol(requestedExchange),
      market: 'UNKNOWN',
      marketOpen: primaryQuote?.marketOpen ?? null,
      lastPrice: primaryQuote?.price ?? null,
      change: primaryQuote?.change ?? null,
      percentChange: primaryQuote?.percentChange ?? null,
      exchangeRate: data.exchangeRate ?? null,
      exchangeRateUpdatedAt: data.exchangeRateUpdatedAt ?? null,
      updatedAt: data.updatedAt ?? null,
      error: data.error
    });
  } catch (error) {
    res.status(502).json({ error: `Unable to load ${requestedExchange} market status: ${error.message}` });
  }
});

app.get('/api/market-data', apiRateLimiter, async (_req, res) => {
  const requestedSymbol = typeof _req.query.symbol === 'string'
    ? _req.query.symbol.trim().toUpperCase()
    : undefined;
  const requestedExchange = typeof _req.query.exchange === 'string'
    ? _req.query.exchange.trim().toUpperCase()
    : 'NSE';
  if (!EXCHANGES.includes(requestedExchange)) {
    return res.status(400).json({ error: 'Choose NSE or BSE.' });
  }
  const chartSymbol = requestedSymbol || getExchangeChartSymbol(requestedExchange);
  if (!getWatchlist(requestedExchange).includes(chartSymbol)) {
    return res.status(400).json({ error: `Choose a chart symbol from the configured ${requestedExchange} watchlist.` });
  }

  try {
    res.json(await getMarketData(chartSymbol, requestedExchange));
  } catch (error) {
    res.status(502).json({ error: `Unable to load ${requestedExchange} market data: ${error.message}` });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Indian market dashboard running at http://localhost:${PORT}`);
    console.log(`Data mode: ${API_KEY ? 'Twelve Data provider configured' : ALPHA_VANTAGE_API_KEY ? 'Alpha Vantage mappings configured where provided' : 'Yahoo Finance fallback'}`);
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
  getMarketData,
  getWatchlist
};
