// Windows shell: the Lead Hub app in its own window, with an optional WhatsApp Web panel on the right.
const { app, BrowserWindow, WebContentsView, shell, Menu, ipcMain, session } = require('electron');
const path = require('path');

const ALLOWED_EXTERNAL = ['https:', 'http:', 'tel:', 'mailto:'];
const WA_HOME = 'https://web.whatsapp.com/';
const WA_PARTITION = 'persist:whatsapp'; // keeps the WhatsApp login between launches
const WA_MIN_WINDOW_WIDTH = 1180;
const WA_BAR_HEIGHT = 44; // strip above the panel where the app draws its Close button (matches .wa-bar in styles.css)

let win = null;
let waView = null;
let waOpen = false;

function openExternal(url) {
  try {
    if (ALLOWED_EXTERNAL.includes(new URL(url).protocol)) shell.openExternal(url);
  } catch {}
}

function isWhatsAppUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'whatsapp.com' || u.hostname.endsWith('.whatsapp.com') || u.hostname.endsWith('.whatsapp.net'));
  } catch {
    return false;
  }
}

// ---------- WhatsApp panel ----------
function waWidth() {
  const [width] = win.getContentSize();
  return Math.max(480, Math.min(720, Math.round(width * 0.42)));
}

function layoutWhatsApp() {
  if (!win || !waView || !waOpen) return;
  const [width, height] = win.getContentSize();
  const w = waWidth();
  waView.setBounds({ x: width - w, y: WA_BAR_HEIGHT, width: w, height: Math.max(0, height - WA_BAR_HEIGHT) });
}

function sendState() {
  if (win && !win.isDestroyed()) win.webContents.send('wa:state', { open: waOpen, width: waOpen ? waWidth() : 0 });
}

function createWhatsAppView() {
  const waSession = session.fromPartition(WA_PARTITION);
  // WhatsApp Web only needs these; everything else is refused.
  waSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isWhatsAppUrl(wc.getURL()) && ['notifications', 'media', 'clipboard-sanitized-write'].includes(permission));
  });
  const view = new WebContentsView({
    webPreferences: { partition: WA_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  // WhatsApp Web refuses browsers it doesn't recognise, so present as plain Chrome.
  const ua = view.webContents.getUserAgent().replace(/\s(?:Electron|lead-hub|LeadHub|Lead Hub)\/\S+/gi, '');
  view.webContents.setUserAgent(ua);
  view.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  view.webContents.on('will-navigate', (event, url) => {
    if (!isWhatsAppUrl(url)) {
      event.preventDefault();
      openExternal(url);
    }
  });
  view.webContents.loadURL(WA_HOME);
  return view;
}

function setWhatsAppOpen(open) {
  if (!win) return;
  if (open === waOpen) return sendState();
  waOpen = open;
  if (open) {
    if (!waView) waView = createWhatsAppView();
    const [width, height] = win.getSize();
    win.setMinimumSize(WA_MIN_WINDOW_WIDTH, 560);
    if (width < WA_MIN_WINDOW_WIDTH && !win.isMaximized()) win.setSize(WA_MIN_WINDOW_WIDTH + 100, height);
    win.contentView.addChildView(waView);
    layoutWhatsApp();
  } else {
    if (waView) win.contentView.removeChildView(waView); // kept alive, so the session stays connected
    win.setMinimumSize(380, 560);
  }
  sendState();
}

function openWhatsAppChat(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return;
  setWhatsAppOpen(true);
  const url = new URL('send', WA_HOME);
  url.searchParams.set('phone', digits);
  const message = String(text || '').slice(0, 2000);
  if (message) url.searchParams.set('text', message);
  waView.webContents.loadURL(url.href);
}

// Only the app's own window may drive the panel.
function fromApp(event) {
  return !!win && event.sender === win.webContents && event.senderFrame && event.senderFrame.url.startsWith('file:');
}
ipcMain.on('wa:toggle', (event) => fromApp(event) && setWhatsAppOpen(!waOpen));
ipcMain.on('wa:close', (event) => fromApp(event) && setWhatsAppOpen(false));
ipcMain.on('wa:open', (event, phone, text) => fromApp(event) && openWhatsAppChat(phone, text));
ipcMain.on('wa:home', (event) => {
  if (!fromApp(event)) return;
  setWhatsAppOpen(true);
  waView.webContents.loadURL(WA_HOME);
});
ipcMain.on('wa:get-state', (event) => fromApp(event) && sendState());

// ---------- main window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 380,
    minHeight: 560,
    title: 'Lead Hub',
    backgroundColor: '#f5f5f7',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'www', 'index.html'));

  // Links (Maps, Call, Website) open in the default browser or app, never inside the window.
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
  win.on('resize', () => {
    layoutWhatsApp();
    if (waOpen) sendState();
  });
  win.on('closed', () => {
    win = null;
    waView = null;
    waOpen = false;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(createWindow);
  app.on('window-all-closed', () => app.quit());
}
