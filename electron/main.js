const { app, BrowserWindow, shell } = require('electron');
const { once } = require('node:events');
const { app: marketApi } = require('../server');

let apiServer;
let dashboardUrl;

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    title: 'NSE Trading Dashboard',
    autoHideMenuBar: true,
    backgroundColor: '#040d14',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(dashboardUrl).origin) {
      event.preventDefault();
    }
  });

  await window.loadURL(dashboardUrl);
}

async function startDashboard() {
  apiServer = marketApi.listen(0, '127.0.0.1');
  await once(apiServer, 'listening');
  const address = apiServer.address();
  if (!address || typeof address === 'string') {
    throw new Error('The local market-data service did not provide a valid address.');
  }
  dashboardUrl = `http://127.0.0.1:${address.port}/`;
  await createWindow();
}

app.whenReady()
  .then(startDashboard)
  .catch((error) => {
    console.error('Unable to start the desktop dashboard:', error);
    app.quit();
  });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && dashboardUrl) {
    void createWindow().catch((error) => {
      console.error('Unable to reopen the desktop dashboard:', error);
    });
  }
});

app.on('before-quit', () => {
  if (apiServer) {
    apiServer.close();
    apiServer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
