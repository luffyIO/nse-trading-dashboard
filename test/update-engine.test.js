const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const {
  APP_VERSION,
  app,
  fetchLatestRelease,
  isNewerVersion,
  parseReleaseVersion
} = require('../server');

test('compares release versions so the update engine only reports real upgrades', () => {
  assert.deepEqual(parseReleaseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
  assert.deepEqual(parseReleaseVersion('2.0'), { major: 2, minor: 0, patch: 0 });
  assert.equal(parseReleaseVersion('not-a-version'), null);

  assert.equal(isNewerVersion(parseReleaseVersion('v1.0.6'), parseReleaseVersion('v1.0.5')), true);
  assert.equal(isNewerVersion(parseReleaseVersion('v1.0.5'), parseReleaseVersion('v1.0.5')), false);
  assert.equal(isNewerVersion(parseReleaseVersion('v1.0.4'), parseReleaseVersion('v1.0.5')), false);
  assert.equal(isNewerVersion(parseReleaseVersion('v2.0.0'), parseReleaseVersion('v1.9.9')), true);
  assert.equal(isNewerVersion(null, parseReleaseVersion('v1.0.5')), false);
});

test('maps the GitHub release payload into a safe summary without leaking tokens', async () => {
  const originalFetch = global.fetch;
  const requestedHeaders = [];
  global.fetch = async (input, options) => {
    requestedHeaders.push(options.headers);
    return {
      ok: true,
      json: async () => ({
        tag_name: 'v9.9.9',
        name: 'Dashboard 9.9.9',
        published_at: '2026-11-14T00:00:00Z',
        html_url: 'https://github.com/luffyIO/nse-trading-dashboard/releases/tag/v9.9.9',
        body: 'Release notes',
        assets: [
          {
            name: 'NSE.Trading.Dashboard-9.9.9-Windows-x64.exe',
            size: 121592441,
            download_count: 7,
            browser_download_url: 'https://github.com/luffyIO/nse-trading-dashboard/releases/download/v9.9.9/app.exe'
          },
          { name: 'missing-url' }
        ]
      })
    };
  };

  try {
    const release = await fetchLatestRelease();
    assert.equal(release.tag, 'v9.9.9');
    assert.equal(release.publishedAt, '2026-11-14T00:00:00Z');
    assert.equal(release.notes, 'Release notes');
    assert.equal(release.assets.length, 1);
    assert.equal(release.assets[0].name, 'NSE.Trading.Dashboard-9.9.9-Windows-x64.exe');
    assert.equal(release.assets[0].downloadCount, 7);
    assert.equal(JSON.stringify(release).includes('GITHUB_TOKEN'), false);
    assert.equal(JSON.stringify(requestedHeaders).includes('undefined'), false);
  } finally {
    global.fetch = originalFetch;
  }
});

test('reports a repository without releases instead of failing the update check', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });

  try {
    const release = await fetchLatestRelease();
    assert.equal(release.tag, null);
    assert.deepEqual(release.assets, []);
    assert.match(release.url, /releases$/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('the releases endpoint returns the installed version and the latest published release', async () => {
  const originalFetch = global.fetch;
  const server = app.listen(0);
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      tag_name: 'v99.0.0',
      published_at: '2026-11-14T00:00:00Z',
      html_url: 'https://github.com/luffyIO/nse-trading-dashboard/releases/tag/v99.0.0',
      body: 'notes',
      assets: []
    })
  });

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const response = await originalFetch(`${baseUrl}/api/releases`);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.currentVersion, APP_VERSION);
    assert.equal(data.latestVersion, 'v99.0.0');
    assert.equal(data.updateAvailable, true);
    assert.equal(data.releaseUrl, 'https://github.com/luffyIO/nse-trading-dashboard/releases/tag/v99.0.0');
  } finally {
    global.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the dashboard ships bottom navigation, tab panels, and a settings tab with toggles', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
  const script = fs.readFileSync(path.join(projectRoot, 'script.js'), 'utf8');

  ['market', 'assistant', 'strategy', 'settings'].forEach((tab) => {
    assert.match(html, new RegExp(`id="tab-${tab}"`));
    assert.match(html, new RegExp(`id="panel-${tab}"`));
  });

  assert.match(html, /class="bottom-nav"/);
  assert.match(html, /role="tab"/);
  assert.match(html, /aria-controls="panel-settings"/);
  assert.match(html, /id="panel-settings"/);

  [
    'settingsDarkTheme',
    'settingsCompactLayout',
    'settingsReduceMotion',
    'settingsAutoRefresh',
    'settingsShowEma',
    'settingsShowGainerHighlights',
    'settingsShowProviderMeta',
    'settingsAutoUpdateCheck'
  ].forEach((controlId) => {
    assert.match(html, new RegExp(`id="${controlId}"`), `missing settings control ${controlId}`);
  });

  assert.match(html, /id="updateCheckButton"/);
  assert.match(html, /id="updateStatusBadge"/);
  assert.match(html, /id="updateLatestVersion"/);
  assert.match(html, /id="settingsProviderSelect"/);
  assert.match(html, /id="settingsExchangeSelect"/);
  assert.match(html, /id="settingsRefreshSeconds"/);
  assert.match(html, /id="settingsResetAll"/);

  assert.match(script, /function setActiveTab\(/);
  assert.match(script, /function checkForUpdates\(/);
  assert.match(script, /\/api\/releases/);
  assert.match(script, /getTabButtons\(\)/);
});

test('the market, assistant, and strategy content each live in their own tab panel', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');

  const marketPanel = html.slice(html.indexOf('id="panel-market"'), html.indexOf('id="panel-assistant"'));
  const assistantPanel = html.slice(html.indexOf('id="panel-assistant"'), html.indexOf('id="panel-strategy"'));
  const strategyPanel = html.slice(html.indexOf('id="panel-strategy"'), html.indexOf('id="panel-settings"'));

  assert.match(marketPanel, /id="watchlist-body"/);
  assert.match(marketPanel, /id="chartSvg"/);
  assert.doesNotMatch(marketPanel, /id="assistantMessages"/);
  assert.doesNotMatch(marketPanel, /class="strategy-section"/);

  assert.match(assistantPanel, /id="assistantMessages"/);
  assert.match(assistantPanel, /id="assistantForm"/);
  assert.doesNotMatch(assistantPanel, /class="strategy-section"/);

  assert.match(strategyPanel, /class="strategy-section"/);
  assert.match(strategyPanel, /id="customStrategies"/);
  assert.doesNotMatch(strategyPanel, /id="assistantMessages"/);
});
