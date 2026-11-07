const fs = require('node:fs');
const path = require('node:path');

const STATIC_FILES = ['index.html', 'script.js', 'strategy-engine.js', 'styles.css'];

function buildPages(apiBaseUrl, outputDirectory) {
  if (!apiBaseUrl) {
    throw new Error('MARKET_API_BASE_URL must point to the deployed HTTPS API before building GitHub Pages.');
  }

  let apiUrl;
  try {
    apiUrl = new URL(apiBaseUrl);
  } catch {
    throw new Error('MARKET_API_BASE_URL must be a valid absolute HTTPS URL.');
  }

  if (apiUrl.protocol !== 'https:' || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error('MARKET_API_BASE_URL must be an HTTPS origin or base path without credentials, query, or fragment.');
  }

  const projectDirectory = __dirname;
  fs.mkdirSync(outputDirectory, { recursive: true });
  STATIC_FILES.forEach((file) => {
    fs.copyFileSync(path.join(projectDirectory, file), path.join(outputDirectory, file));
  });
  fs.writeFileSync(
    path.join(outputDirectory, 'config.js'),
    `window.MARKET_API_BASE_URL = ${JSON.stringify(apiUrl.href.replace(/\/+$/, ''))};\n`,
    'utf8'
  );
}

if (require.main === module) {
  const outputDirectory = path.resolve(process.argv[2] || path.join(__dirname, 'dist'));
  try {
    buildPages(process.env.MARKET_API_BASE_URL, outputDirectory);
    console.log(`GitHub Pages site built at ${outputDirectory}`);
  } catch (error) {
    console.error(`GitHub Pages build failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { buildPages };
