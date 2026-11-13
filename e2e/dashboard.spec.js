const { test, expect } = require('@playwright/test');

const MARKET_DATA = {
  NSE: {
    configured: true,
    source: 'yahoo-finance-unofficial',
    provider: 'Yahoo Finance (unofficial)',
    currency: 'INR',
    exchange: 'NSE',
    refreshSeconds: 60,
    updatedAt: '2026-11-13T09:09:55.911Z',
    chartSymbol: 'RELIANCE',
    chartSymbols: ['RELIANCE', 'TCS'],
    quotes: [
      {
        symbol: 'RELIANCE',
        name: 'Reliance Industries Limited',
        price: 1338,
        change: -1.7,
        percentChange: -0.13,
        currency: 'INR',
        timestamp: '14:39',
        marketOpen: null
      },
      {
        symbol: 'TCS',
        name: 'Tata Consultancy Services Limited',
        price: 2409.9,
        change: 32.5,
        percentChange: 1.37,
        currency: 'INR',
        timestamp: '14:39',
        marketOpen: null
      }
    ],
    chart: [
      { time: '2026-11-13T09:15:00.000Z', close: 1330.5 },
      { time: '2026-11-13T09:20:00.000Z', close: 1338 }
    ],
    exchangeRate: 94.2475,
    exchangeRateUpdatedAt: '2026-11-13T09:09:39.000Z'
  },
  BSE: {
    configured: true,
    source: 'yahoo-finance-unofficial',
    provider: 'Yahoo Finance (unofficial)',
    currency: 'INR',
    exchange: 'BSE',
    refreshSeconds: 60,
    updatedAt: '2026-11-13T09:10:12.000Z',
    chartSymbol: 'RELIANCE',
    chartSymbols: ['RELIANCE'],
    quotes: [
      {
        symbol: 'RELIANCE',
        name: 'Reliance Industries Limited',
        price: 1341.25,
        change: 2.1,
        percentChange: 0.16,
        currency: 'INR',
        timestamp: '14:40',
        marketOpen: null
      }
    ],
    chart: [
      { time: '2026-11-13T09:15:00.000Z', close: 1339 },
      { time: '2026-11-13T09:20:00.000Z', close: 1341.25 }
    ],
    exchangeRate: 94.248,
    exchangeRateUpdatedAt: '2026-11-13T09:10:05.000Z'
  }
};

const RELEASES = {
  ok: true,
  currentVersion: '1.0.5',
  latestVersion: 'v1.0.5',
  updateAvailable: false,
  publishedAt: '2026-11-10T16:41:45Z',
  releaseUrl: 'https://github.com/luffyIO/nse-trading-dashboard/releases/tag/v1.0.5',
  releaseName: 'v1.0.5',
  notes: '',
  assets: [],
  checkedAt: '2026-11-13T09:00:00.000Z'
};

function buildHealth(exchange) {
  const symbols = exchange === 'BSE' ? ['RELIANCE'] : ['RELIANCE', 'TCS'];
  return {
    ok: true,
    configured: true,
    provider: 'Yahoo Finance (unofficial)',
    mode: 'yahoo-finance-unofficial',
    exchanges: ['NSE', 'BSE'],
    exchange,
    currency: 'INR',
    symbols,
    markets: {
      NSE: { symbols: ['RELIANCE', 'TCS'], alphaVantageConfigured: false },
      BSE: { symbols: ['RELIANCE'], alphaVantageConfigured: false }
    },
    providers: [
      { id: 'auto', name: 'Auto · default fallback', available: true },
      { id: 'yahoo', name: 'Yahoo Finance · unofficial', available: true }
    ],
    refreshSeconds: 60
  };
}

async function stubApi(page, { marketDataStatus = 200 } = {}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const exchange = url.searchParams.get('exchange') === 'BSE' ? 'BSE' : 'NSE';

    if (url.pathname.endsWith('/api/health')) {
      return route.fulfill({ json: buildHealth(exchange) });
    }
    if (url.pathname.endsWith('/api/releases')) {
      return route.fulfill({ json: RELEASES });
    }
    if (url.pathname.endsWith('/api/status')) {
      const quote = MARKET_DATA[exchange].quotes[0];
      return route.fulfill({
        json: {
          configured: true,
          source: MARKET_DATA[exchange].source,
          exchange,
          currency: 'INR',
          symbol: quote.symbol,
          market: 'UNKNOWN',
          marketOpen: null,
          lastPrice: quote.price,
          change: quote.change,
          percentChange: quote.percentChange,
          updatedAt: MARKET_DATA[exchange].updatedAt
        }
      });
    }
    if (url.pathname.endsWith('/api/market-data')) {
      if (marketDataStatus !== 200) {
        return route.fulfill({
          status: marketDataStatus,
          json: { error: 'Fixture provider unavailable' }
        });
      }
      return route.fulfill({ json: MARKET_DATA[exchange] });
    }
    return route.fulfill({ status: 404, json: { error: 'Not found' } });
  });
}

test('renders the watchlist and primary quote from the configured feed', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await expect(page).toHaveTitle('NSE Trading Dashboard');
  await expect(page.getByRole('heading', { name: 'Market dashboard' })).toBeVisible();
  await expect(page.locator('#primaryQuotePrice')).toContainText('1,338');
  await expect(page.locator('#primaryQuoteChange')).toHaveText('-0.13%');
  await expect(page.locator('#watchlist-body tr')).toHaveCount(2);
  await expect(page.locator('#watchlist-body tr').first()).toContainText('RELIANCE');
  await expect(page.locator('#watchlistStatus')).toContainText('Yahoo');
  await expect(page.locator('#chartLastPrice')).toContainText('1,338');
});

test('switches to BSE and refetches quotes for that exchange', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await expect(page.locator('#primaryQuotePrice')).toContainText('1,338');

  const bseRequest = page.waitForRequest(
    (request) => request.url().includes('/api/market-data') && request.url().includes('exchange=BSE')
  );
  await page.locator('#exchangeSelect').selectOption('BSE');
  await bseRequest;

  await expect(page.locator('#selectedExchangeLabel')).toHaveText('BSE');
  await expect(page.locator('#marketContext')).toHaveText('BSE');
  await expect(page.locator('#primaryQuotePrice')).toContainText('1,341');
  await expect(page.locator('#watchlist-body tr')).toHaveCount(1);
});

test('assistant answers a symbol question from the loaded quotes', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');
  await expect(page.locator('#primaryQuotePrice')).toContainText('1,338');

  await page.locator('#tab-assistant').click();
  await page.locator('#assistantInput').fill('What is RELIANCE trading at?');
  await page.locator('#assistantForm').getByRole('button', { name: 'Send' }).click();

  const lastMessage = page.locator('.assistant-message-assistant').last();
  await expect(lastMessage).toContainText('RELIANCE');
  await expect(lastMessage).toContainText('1,338');
  await expect(page.locator('.assistant-message-user').last()).toContainText('What is RELIANCE trading at?');
});

test('update panel reports that the installed version is current', async ({ page }) => {
  await stubApi(page);
  await page.goto('/');

  await page.locator('#tab-settings').click();
  await page.locator('#updateCheckButton').click();

  await expect(page.locator('#updateStatusBadge')).toHaveText('Up to date');
  await expect(page.locator('#updateCurrentVersion')).toHaveText('1.0.5');
  await expect(page.locator('#updateLatestVersion')).toHaveText('v1.0.5');
});

test('shows a provider failure instead of inventing quotes', async ({ page }) => {
  await stubApi(page, { marketDataStatus: 502 });
  await page.goto('/');

  await expect(page.locator('#feedMessage')).toContainText('HTTP 502');
  await expect(page.locator('#primaryQuotePrice')).toHaveText('—');
  await expect(page.locator('#watchlist-body')).toContainText('Waiting for configured NSE quote data');
});
