const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TWELVE_DATA_API_KEY = 'test-key';
const {
  buildMarketData,
  buildTwelveDataMarketData,
  buildYahooMarketData
} = require('../server');

test('builds an NSE watchlist, chart series, and USD/INR rate from provider responses', async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);

    let payload;
    if (url.pathname === '/quote') {
      const symbol = url.searchParams.get('symbol');
      payload = {
        symbol,
        name: `${symbol} Limited`,
        currency: 'INR',
        close: '1250.50',
        change: '12.50',
        percent_change: '1.01',
        datetime: '2026-11-07 15:30:00',
        is_market_open: false
      };
    } else if (url.pathname === '/time_series') {
      payload = {
        values: [
          { datetime: '2026-11-07 09:15:00', close: '1238.00' },
          { datetime: '2026-11-07 09:20:00', close: '1250.50' }
        ]
      };
    } else if (url.pathname === '/exchange_rate') {
      payload = { rate: '88.1234' };
    } else {
      throw new Error(`Unexpected provider endpoint: ${url.pathname}`);
    }

    return {
      ok: true,
      json: async () => payload
    };
  };

  try {
    const data = await buildTwelveDataMarketData();
    assert.equal(data.configured, true);
    assert.equal(data.source, 'twelvedata');
    assert.equal(data.currency, 'INR');
    assert.equal(data.exchange, 'NSE');
    assert.equal(data.chartSymbol, 'RELIANCE');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.quotes[0].price, 1250.5);
    assert.equal(data.quotes[0].percentChange, 1.01);
    assert.equal(data.quotes[0].marketOpen, false);
    assert.equal(data.exchangeRate, 88.1234);
    assert.deepEqual(data.chart.map((point) => point.close), [1238, 1250.5]);
    assert.equal(requestedUrls.every((url) => url.searchParams.get('apikey') === 'test-key'), true);
    assert.equal(requestedUrls.filter((url) => url.pathname === '/quote').length, 5);
  } finally {
    global.fetch = originalFetch;
  }
});

test('reports provider errors without inventing replacement quotes', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ code: 400, message: 'Invalid symbol or subscription' })
  });

  try {
    const data = await buildTwelveDataMarketData();
    assert.equal(data.configured, true);
    assert.deepEqual(data.quotes, []);
    assert.equal(data.error.includes('No NSE quotes could be loaded'), true);
    assert.deepEqual(data.chart, []);
    assert.equal(data.exchangeRate, null);
    assert.equal(data.source, 'twelvedata');
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects stock quotes returned in a non-INR currency', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/quote') {
      return {
        ok: true,
        json: async () => ({
          close: '100',
          currency: 'USD',
          percent_change: '1.2'
        })
      };
    }

    return {
      ok: true,
      json: async () => url.pathname === '/time_series'
        ? { values: [] }
        : { rate: '88.2' }
    };
  };

  try {
    const data = await buildTwelveDataMarketData();
    assert.deepEqual(data.quotes, []);
    assert.equal(data.error.includes('No NSE quotes could be loaded'), true);
    assert.equal(data.errors.some((message) => message.includes('Expected INR data')), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('extracts free Yahoo Finance NSE quotes, intraday bars, and USD/INR without fabricating data', async () => {
  const originalFetch = global.fetch;
  const requestedUrls = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    requestedUrls.push(url);
    const symbol = decodeURIComponent(url.pathname.split('/').pop());
    const isFx = symbol === 'USDINR=X';
    const payload = {
      chart: {
        result: [{
          meta: {
            currency: 'INR',
            longName: isFx ? 'USD/INR' : `${symbol.replace('.NS', '')} Limited`,
            regularMarketPrice: isFx ? 88.25 : 1520.75,
            previousClose: isFx ? 87.5 : 1500,
            regularMarketTime: 1793959200
          },
          timestamp: [1793958900, 1793959200],
          indicators: {
            quote: [{ close: [1518.25, 1520.75] }]
          }
        }],
        error: null
      }
    };

    return { ok: true, json: async () => payload };
  };

  try {
    const data = await buildYahooMarketData();
    assert.equal(data.configured, true);
    assert.equal(data.source, 'yahoo-finance-unofficial');
    assert.equal(data.exchange, 'NSE');
    assert.equal(data.currency, 'INR');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.quotes[0].symbol, 'RELIANCE');
    assert.equal(data.quotes[0].price, 1520.75);
    assert.equal(data.quotes[0].change, 20.75);
    assert.equal(data.quotes[0].percentChange, 20.75 / 1500 * 100);
    assert.equal(data.chart.length, 2);
    assert.equal(data.chart[1].close, 1520.75);
    assert.equal(data.exchangeRate, 88.25);
    assert.equal(data.disclaimer.includes('not guaranteed'), true);
    assert.equal(requestedUrls.some((url) => url.pathname.endsWith('/RELIANCE.NS')), true);
    assert.equal(requestedUrls.some((url) => decodeURIComponent(url.pathname).endsWith('/USDINR=X')), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('falls back to Yahoo Finance when an authorized provider returns no usable quotes', async () => {
  const originalFetch = global.fetch;

  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'api.twelvedata.com') {
      return {
        ok: true,
        json: async () => ({ code: 400, message: 'Provider plan unavailable' })
      };
    }

    const symbol = decodeURIComponent(url.pathname.split('/').pop());
    const isFx = symbol === 'USDINR=X';
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              currency: 'INR',
              regularMarketPrice: isFx ? 88 : 100,
              previousClose: 99,
              regularMarketTime: 1793959200
            },
            timestamp: [1793958900, 1793959200],
            indicators: { quote: [{ close: [99.5, 100] }] }
          }],
          error: null
        }
      })
    };
  };

  try {
    const data = await buildMarketData();
    assert.equal(data.source, 'yahoo-finance-unofficial');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.errors[0].startsWith('Twelve Data unavailable:'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
