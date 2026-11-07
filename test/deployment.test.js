const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPages } = require('../build-pages');
const { createCorsMiddleware, createRateLimiter } = require('../server');

function runCorsMiddleware(origin, method = 'GET') {
  const headers = {};
  const response = {
    statusCode: null,
    vary(value) {
      headers.Vary = value;
      return this;
    },
    set(name, value) {
      headers[name] = value;
      return this;
    },
    sendStatus(status) {
      this.statusCode = status;
      return this;
    }
  };
  let nextCalled = false;
  const middleware = createCorsMiddleware(new Set(['https://example.github.io']));
  middleware(
    { method, get: (name) => name === 'Origin' ? origin : undefined },
    response,
    () => { nextCalled = true; }
  );
  return { headers, response, nextCalled };
}

test('allows only the configured Pages origin and answers its preflight', () => {
  const allowed = runCorsMiddleware('https://example.github.io');
  assert.equal(allowed.headers['Access-Control-Allow-Origin'], 'https://example.github.io');
  assert.equal(allowed.nextCalled, true);

  const preflight = runCorsMiddleware('https://example.github.io', 'OPTIONS');
  assert.equal(preflight.response.statusCode, 204);
  assert.equal(preflight.nextCalled, false);

  const denied = runCorsMiddleware('https://other.example');
  assert.equal(denied.headers['Access-Control-Allow-Origin'], undefined);
  assert.equal(denied.nextCalled, true);

  const deniedPreflight = runCorsMiddleware('https://other.example', 'OPTIONS');
  assert.equal(deniedPreflight.response.statusCode, 403);
});

test('builds a Pages artifact with an HTTPS backend URL and no server source', () => {
  const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-pages-'));
  try {
    buildPages('https://market-api.example.com/', outputDirectory);
    assert.equal(fs.existsSync(path.join(outputDirectory, 'index.html')), true);
    assert.equal(fs.existsSync(path.join(outputDirectory, 'server.js')), false);
    assert.equal(
      fs.readFileSync(path.join(outputDirectory, 'config.js'), 'utf8'),
      'window.MARKET_API_BASE_URL = "https://market-api.example.com";\n'
    );
    assert.throws(() => buildPages('', outputDirectory), /must point to the deployed HTTPS API/);
    assert.throws(() => buildPages('http://market-api.example.com', outputDirectory), /must be an HTTPS origin/);
  } finally {
    fs.rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test('rate limits repeated API requests and supplies a retry interval', () => {
  const middleware = createRateLimiter({ windowMs: 60000, maxRequests: 2 });
  const makeRequest = (ip) => {
    const headers = {};
    const response = {
      statusCode: 200,
      body: null,
      set(name, value) {
        headers[name] = value;
        return this;
      },
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      }
    };
    let nextCalled = false;
    middleware(
      { ip, socket: { remoteAddress: ip } },
      response,
      () => { nextCalled = true; }
    );
    return { headers, response, nextCalled };
  };

  assert.equal(makeRequest('192.0.2.1').nextCalled, true);
  assert.equal(makeRequest('192.0.2.1').nextCalled, true);
  const limited = makeRequest('192.0.2.1');
  assert.equal(limited.response.statusCode, 429);
  assert.equal(Number(limited.headers['Retry-After']) > 0, true);
  assert.equal(makeRequest('192.0.2.2').nextCalled, true);
});
