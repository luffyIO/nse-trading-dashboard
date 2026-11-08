const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildPages } = require('./build-pages');

const projectDirectory = __dirname;
const androidDirectory = path.join(projectDirectory, 'android');

function ensureJavaVersion() {
  const result = spawnSync('java', ['-version'], { encoding: 'utf8' });
  if (result.error) {
    throw new Error('JDK 21 or later is required to build the Android app.');
  }

  const version = `${result.stdout || ''}\n${result.stderr || ''}`.match(/version\s+"(?:1\.)?(\d+)/);
  if (!version || Number(version[1]) < 21) {
    throw new Error('JDK 21 or later is required to build the Android app.');
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with status ${result.status}.`);
  }
}

function buildAndroid() {
  ensureJavaVersion();
  buildPages(process.env.MARKET_API_BASE_URL, path.join(projectDirectory, 'dist'));

  const capacitorCli = path.join(projectDirectory, 'node_modules', '@capacitor', 'cli', 'bin', 'capacitor');
  run(process.execPath, [capacitorCli, 'sync', 'android'], projectDirectory);

  if (process.platform === 'win32') {
    const commandShell = process.env.ComSpec || 'cmd.exe';
    run(commandShell, ['/d', '/s', '/c', 'gradlew.bat testDebugUnitTest assembleDebug'], androidDirectory);
  } else {
    run('bash', ['gradlew', 'testDebugUnitTest', 'assembleDebug'], androidDirectory);
  }
}

if (require.main === module) {
  try {
    buildAndroid();
  } catch (error) {
    console.error(`Android build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildAndroid };
