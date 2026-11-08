const test = require('node:test');
const assert = require('node:assert/strict');

process.env.TWELVE_DATA_API_KEY = 'test-key';
process.env.ALPHA_VANTAGE_API_KEY = 'alpha-test-key';
process.env.ALPHA_VANTAGE_SYMBOL_MAP = JSON.stringify({
  RELIANCE: { symbol: 'RELIANCE.NSE', exchange: 'NSE', currency: 'INR' },
  TCS: { symbol: 'TCS.NSE', exchange: 'NSE', currency: 'INR' },
  HDFCBANK: { symbol: 'HDFCBANK.NSE', exchange: 'NSE', currency: 'INR' },
  INFY: { symbol: 'INFY.NSE', exchange: 'NSE', currency: 'INR' },
  ICICIBANK: { symbol: 'ICICIBANK.NSE', exchange: 'NSE', currency: 'INR' },
  'BSE:RELIANCE': { symbol: 'RELIANCE.BSE', exchange: 'BSE', currency: 'INR' },
  'BSE:TCS': { symbol: 'TCS.BSE', exchange: 'BSE', currency: 'INR' },
  'BSE:HDFCBANK': { symbol: 'HDFCBANK.BSE', exchange: 'BSE', currency: 'INR' },
  'BSE:INFY': { symbol: 'INFY.BSE', exchange: 'BSE', currency: 'INR' },
  'BSE:ICICIBANK': { symbol: 'ICICIBANK.BSE', exchange: 'BSE', currency: 'INR' }
});
const {
  app,
  buildMarketData,
  buildAlphaVantageMarketData,
  buildTwelveDataMarketData,
  buildYahooMarketData,
  fetchAlphaVantageQuote,
  getMarketData
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

test('builds a separate BSE watchlist and uses BSE Yahoo symbols for quotes and charts', async () => {
  const originalFetch = global.fetch;
  const requestedSymbols = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    const symbol = decodeURIComponent(url.pathname.split('/').pop());
    requestedSymbols.push(symbol);
    const isFx = symbol === 'USDINR=X';
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: {
              currency: 'INR',
              regularMarketPrice: isFx ? 88.4 : 2520,
              previousClose: isFx ? 88.2 : 2500,
              regularMarketTime: 1793959200,
              symbol
            },
            timestamp: [1793958900, 1793959200],
            indicators: { quote: [{ close: [2510, 2520] }] }
          }],
          error: null
        }
      })
    };
  };

  try {
    const data = await buildYahooMarketData('TCS', 'BSE');
    assert.equal(data.exchange, 'BSE');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.chartSymbol, 'TCS');
    assert.equal(data.chart[1].close, 2520);
    assert.equal(data.exchangeRate, 88.4);
    assert.equal(data.exchangeRateSource, 'Yahoo Finance (unofficial)');
    assert.equal(requestedSymbols.includes('RELIANCE.BO'), true);
    assert.equal(requestedSymbols.includes('TCS.BO'), true);
    assert.equal(requestedSymbols.includes('TCS.NS'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('requests BSE quotes and intraday bars from Twelve Data using the BSE exchange', async () => {
  const originalFetch = global.fetch;
  const requestedExchanges = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    requestedExchanges.push(url.searchParams.get('exchange'));
    if (url.pathname === '/quote') {
      return {
        ok: true,
        json: async () => ({
          close: '100',
          currency: 'INR',
          exchange: 'BSE',
          percent_change: '0.5'
        })
      };
    }
    if (url.pathname === '/time_series') {
      return {
        ok: true,
        json: async () => ({ values: [{ datetime: '2026-11-07 09:15:00', close: '100' }] })
      };
    }
    return {
      ok: true,
      json: async () => ({ rate: '88.4', timestamp: 1793959200 })
    };
  };

  try {
    const data = await buildTwelveDataMarketData('TCS', 'BSE');
    assert.equal(data.exchange, 'BSE');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.chartSymbol, 'TCS');
    assert.equal(data.exchangeRate, 88.4);
    assert.equal(data.exchangeRateSource, 'Twelve Data');
    assert.equal(data.exchangeRateUpdatedAt, '2026-11-06T10:00:00.000Z');
    assert.equal(requestedExchanges.filter((exchange) => exchange === 'BSE').length, 6);
  } finally {
    global.fetch = originalFetch;
  }
});

test('market-data API selects the requested exchange and rejects unknown exchanges and symbols', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/quote') {
      return {
        ok: true,
        json: async () => ({
          close: '100',
          currency: 'INR',
          exchange: url.searchParams.get('exchange'),
          percent_change: '0.5'
        })
      };
    }
    if (url.pathname === '/time_series') {
      return { ok: true, json: async () => ({ values: [{ datetime: '2026-11-07 09:15:00', close: '100' }] }) };
    }
    return { ok: true, json: async () => ({ rate: '88.4', timestamp: 1793959200 }) };
  };

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const bseResponse = await originalFetch(`${baseUrl}/api/market-data?exchange=BSE&symbol=TCS`);
    const bseData = await bseResponse.json();
    assert.equal(bseResponse.status, 200);
    assert.equal(bseData.exchange, 'BSE');
    assert.equal(bseData.chartSymbol, 'TCS');

    const invalidExchange = await originalFetch(`${baseUrl}/api/market-data?exchange=NYSE`);
    assert.equal(invalidExchange.status, 400);
    const invalidSymbol = await originalFetch(`${baseUrl}/api/market-data?exchange=BSE&symbol=NOT_CONFIGURED`);
    assert.equal(invalidSymbol.status, 400);
    const health = await originalFetch(`${baseUrl}/api/health`).then((response) => response.json());
    assert.deepEqual(health.exchanges, ['NSE', 'BSE']);
    assert.deepEqual(health.markets.BSE.symbols, ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK']);
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('builds Alpha Vantage watchlist quotes only for explicitly mapped symbols', async () => {
  const originalFetch = global.fetch;
  const alphaSymbols = [];
  const yahooSymbols = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'www.alphavantage.co') {
      const symbol = url.searchParams.get('symbol');
      alphaSymbols.push(symbol);
      return {
        ok: true,
        json: async () => ({
          'Global Quote': {
            '01. symbol': symbol,
            '05. price': '123.45',
            '09. change': '1.23',
            '10. change percent': '1.00%',
            '07. latest trading day': '2026-11-07'
          }
        })
      };
    }

    const symbol = decodeURIComponent(url.pathname.split('/').pop());
    yahooSymbols.push(symbol);
    const isFx = symbol === 'USDINR=X';
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { regularMarketPrice: isFx ? 88.25 : 123.45 },
            timestamp: [1793959200],
            indicators: { quote: [{ close: [123.45] }] }
          }],
          error: null
        }
      })
    };
  };

  try {
    const data = await buildAlphaVantageMarketData('TCS');
    assert.equal(data.source, 'alpha-vantage');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.quotes[0].symbol, 'RELIANCE');
    assert.equal(data.quotes[0].currency, 'INR');
    assert.equal(data.chartSymbol, 'TCS');
    assert.equal(alphaSymbols.length, 5);
    assert.equal(alphaSymbols.includes('TCS.NSE'), true);
    assert.deepEqual(yahooSymbols.sort(), ['TCS.NS', 'USDINR=X']);
  } finally {
    global.fetch = originalFetch;
  }
});

test('builds Alpha Vantage BSE quotes only from BSE-prefixed verified mappings', async () => {
  const originalFetch = global.fetch;
  const alphaSymbols = [];
  const yahooSymbols = [];

  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.hostname === 'www.alphavantage.co') {
      const symbol = url.searchParams.get('symbol');
      alphaSymbols.push(symbol);
      return {
        ok: true,
        json: async () => ({
          'Global Quote': {
            '01. symbol': symbol,
            '05. price': '223.45',
            '09. change': '2.23',
            '10. change percent': '1.00%',
            '07. latest trading day': '2026-11-07'
          }
        })
      };
    }

    const symbol = decodeURIComponent(url.pathname.split('/').pop());
    yahooSymbols.push(symbol);
    const isFx = symbol === 'USDINR=X';
    return {
      ok: true,
      json: async () => ({
        chart: {
          result: [{
            meta: { regularMarketPrice: isFx ? 88.25 : 223.45, regularMarketTime: 1793959200 },
            timestamp: [1793959200],
            indicators: { quote: [{ close: [223.45] }] }
          }],
          error: null
        }
      })
    };
  };

  try {
    const data = await buildAlphaVantageMarketData('RELIANCE', 'BSE');
    assert.equal(data.exchange, 'BSE');
    assert.equal(data.source, 'alpha-vantage');
    assert.equal(data.quotes.length, 5);
    assert.equal(alphaSymbols.includes('RELIANCE.BSE'), true);
    assert.equal(yahooSymbols.includes('RELIANCE.BO'), true);
    assert.equal(yahooSymbols.includes('RELIANCE.NS'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects an Alpha Vantage response for a different provider symbol', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      'Global Quote': {
        '01. symbol': 'UNRELATED',
        '05. price': '123.45',
        '10. change percent': '1.00%'
      }
    })
  });

  try {
    await assert.rejects(fetchAlphaVantageQuote('RELIANCE'), /did not return a complete .* quote/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects incomplete Alpha Vantage change data instead of treating blanks as zero', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      'Global Quote': {
        '01. symbol': 'RELIANCE.NSE',
        '05. price': '123.45',
        '09. change': '',
        '10. change percent': ''
      }
    })
  });

  try {
    await assert.rejects(fetchAlphaVantageQuote('RELIANCE'), /did not return a complete .* quote/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('keeps independently selected chart symbols isolated in the market-data cache', async () => {
  const originalFetch = global.fetch;
  const chartSymbols = [];
  global.fetch = async (input) => {
    const url = new URL(input);
    if (url.pathname === '/quote') {
      return {
        ok: true,
        json: async () => ({
          close: '100',
          currency: 'INR',
          percent_change: '1'
        })
      };
    }
    if (url.pathname === '/time_series') {
      const symbol = url.searchParams.get('symbol');
      chartSymbols.push(symbol);
      return {
        ok: true,
        json: async () => ({ values: [{ datetime: '2026-11-07 09:15:00', close: symbol === 'TCS' ? '200' : '300' }] })
      };
    }
    return { ok: true, json: async () => ({ rate: '88.2' }) };
  };

  try {
    const [tcs, infy] = await Promise.all([getMarketData('TCS'), getMarketData('INFY')]);
    assert.equal(tcs.chartSymbol, 'TCS');
    assert.equal(infy.chartSymbol, 'INFY');
    assert.equal(tcs.chart[0].close, 200);
    assert.equal(infy.chart[0].close, 300);
    assert.deepEqual(chartSymbols.sort(), ['INFY', 'TCS']);
    await assert.rejects(getMarketData('OUTSIDE_WATCHLIST'), /not in the configured NSE watchlist/);
    await assert.rejects(getMarketData('RELIANCE', 'SENSEX'), /exchange is not supported/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('uses the mapped Alpha Vantage fallback when Twelve Data returns no usable quotes', async () => {
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
    assert.equal(data.source, 'alpha-vantage');
    assert.equal(data.quotes.length, 5);
    assert.equal(data.errors[0].startsWith('Twelve Data unavailable:'), true);
  } finally {
    global.fetch = originalFetch;
  }
});
