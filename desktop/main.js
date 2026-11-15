// Windows shell: opens the same web app in its own window.
const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');

const ALLOWED_EXTERNAL = ['https:', 'http:', 'tel:', 'mailto:'];

function openExternal(url) {
  try {
    if (ALLOWED_EXTERNAL.includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {}
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 380,
    minHeight: 560,
    title: 'Lead Hub',
    backgroundColor: '#f5f5f7',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));

  // Links (WhatsApp, Maps, Call) open in the default browser or app, never inside the window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file:')) {
      event.preventDefault();
      openExternal(url);
    }
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
