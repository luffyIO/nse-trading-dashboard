const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const packageJson = require(path.join(projectRoot, 'package.json'));

test('defines installable desktop builds for Windows, macOS, and Linux', () => {
  assert.equal(packageJson.main, 'electron/main.js');
  assert.equal(fs.existsSync(path.join(projectRoot, packageJson.main)), true);
  assert.match(packageJson.scripts['dist:win'], /--win nsis/);
  assert.match(packageJson.scripts['dist:mac'], /--mac dmg/);
  assert.match(packageJson.scripts['dist:linux'], /AppImage deb/);
  assert.equal(packageJson.build.productName, 'NSE Trading Dashboard');
});

test('builds the desktop app from the local service and enables renderer isolation', () => {
  const desktopMain = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');
  assert.match(desktopMain, /require\('\.\.\/server'\)/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /nodeIntegration: false/);
  assert.match(desktopMain, /sandbox: true/);
  assert.match(desktopMain, /127\.0\.0\.1/);
});
