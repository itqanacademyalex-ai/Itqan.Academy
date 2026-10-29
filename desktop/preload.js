/* جسر صغير وآمن بين الموقع والتطبيق (مفيش وصول للملفات أو للجهاز) */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('itqanApp', {
  isApp: true,
  /* prompt() بديل — Electron مابيدعمش prompt الأصلي */
  prompt: (msg, def) => ipcRenderer.sendSync('prompt', String(msg == null ? '' : msg), def == null ? '' : String(def)),
  /* شاشة البداية */
  clipRead: () => ipcRenderer.invoke('clip:read'),
  openInvite: (u, role) => ipcRenderer.invoke('invite:open', String(u || ''), String(role || '')),
  /* نافذة اختيار الشاشة */
  pickerSources: () => ipcRenderer.invoke('picker:get'),
  pickerDone: v => ipcRenderer.send('picker:done', v),
  /* الرسم على الشاشة المشاركة */
  share: on => ipcRenderer.send('share', !!on),
  ann: m => ipcRenderer.send('ann', m),
  onAnn: cb => { ipcRenderer.on('ann', (e, m) => cb(m)); },
  /* نافذة الإدخال */
  promptGet: () => ipcRenderer.invoke('prompt:get'),
  promptDone: v => ipcRenderer.send('prompt:done', v)
});
