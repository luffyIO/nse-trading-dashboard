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
  assert.ok(
    ['dist:win', 'dist:mac', 'dist:linux'].every((script) => /--publish never/.test(packageJson.scripts[script]))
  );
  assert.match(packageJson.author, /<[^>]+@[^>]+>/);
  assert.equal(packageJson.build.productName, 'NSE Trading Dashboard');
});

test('builds the desktop app from the local service and enables renderer isolation', () => {
  const desktopMain = fs.readFileSync(path.join(projectRoot, 'electron', 'main.js'), 'utf8');
  const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'desktop.yml'), 'utf8');
  assert.match(desktopMain, /require\('\.\.\/server'\)/);
  assert.match(desktopMain, /contextIsolation: true/);
  assert.match(desktopMain, /nodeIntegration: false/);
  assert.match(desktopMain, /sandbox: true/);
  assert.match(desktopMain, /127\.0\.0\.1/);
  assert.match(workflow, /release:[\s\S]*?uses: actions\/checkout@v4/);
});

test('defines an installable Capacitor Android build and release artifact', () => {
  const capacitorConfig = require(path.join(projectRoot, 'capacitor.config.json'));
  const workflow = fs.readFileSync(path.join(projectRoot, '.github', 'workflows', 'desktop.yml'), 'utf8');
  const androidBuild = fs.readFileSync(path.join(projectRoot, 'android', 'app', 'build.gradle'), 'utf8');

  assert.equal(packageJson.scripts['build:android'], 'node build-android.js');
  assert.match(packageJson.devDependencies['@capacitor/android'], /^\^7\./);
  assert.match(packageJson.devDependencies['@capacitor/core'], /^\^7\./);
  assert.match(packageJson.devDependencies['@capacitor/cli'], /^\^7\./);
  assert.equal(capacitorConfig.appId, packageJson.build.appId);
  assert.equal(capacitorConfig.webDir, 'dist');
  assert.equal(capacitorConfig.server.androidScheme, 'https');
  assert.match(androidBuild, /versionName dashboardVersion/);
  assert.match(androidBuild, /versionCode versionParts/);
  assert.equal(fs.existsSync(path.join(projectRoot, 'android', 'gradlew')), true);
  assert.equal(fs.existsSync(path.join(projectRoot, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')), true);
  assert.match(workflow, /platform: android[\s\S]*?command: build:android[\s\S]*?app-debug\.apk/);
  assert.match(workflow, /MARKET_API_BASE_URL: \$\{\{ vars\.MARKET_API_BASE_URL \}\}/);
});
