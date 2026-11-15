// Bridge between the app's page and the desktop shell. Exposes only the WhatsApp panel controls.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('leadHubDesktop', {
  whatsapp: {
    toggle: () => ipcRenderer.send('wa:toggle'),
    close: () => ipcRenderer.send('wa:close'),
    home: () => ipcRenderer.send('wa:home'),
    open: (phone, text) => ipcRenderer.send('wa:open', String(phone || ''), String(text || '')),
    requestState: () => ipcRenderer.send('wa:get-state'),
    onState: (callback) => {
      ipcRenderer.on('wa:state', (_event, state) => callback({ open: !!state.open, width: Number(state.width) || 0 }));
    },
  },
});
