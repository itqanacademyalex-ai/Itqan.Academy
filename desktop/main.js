/* أكاديمية إتقان — تطبيق الكمبيوتر
   التطبيق يفتح نفس الموقع المنشور على GitHub Pages، فأي تحديث للموقع يوصل للتطبيق تلقائياً،
   والروابط اللي السكرتارية بتعملها من التطبيق هي نفس روابط الموقع وتشتغل عند أي حد في المتصفح. */
const { app, BrowserWindow, session, desktopCapturer, ipcMain, shell, dialog, Menu, powerSaveBlocker, clipboard, screen } = require('electron');
const path = require('path');

const SITE = process.env.ITQAN_SITE || 'https://itqanacademyalex-ai.github.io/Itqan.Academy/'; // ITQAN_SITE للاختبار فقط
const SITE_ORIGIN = new URL(SITE).origin;
const PROTO = 'itqan';

const isSite = u => { try { return new URL(u).origin === SITE_ORIGIN; } catch (e) { return false; } };

/* رابط دعوة من السكرتارية: https://.../?s=..&k=..&r=t|s  أو  itqan://open?u=<الرابط> */
function inviteUrl(raw) {
  raw = String(raw || '').trim();
  if (raw.startsWith(PROTO + '://')) { try { raw = new URL(raw).searchParams.get('u') || ''; } catch (e) { return null; } }
  if (!isSite(raw)) return null;
  const q = new URL(raw).searchParams;
  if (/^([a-z0-9]{4}|[a-z0-9]{6})$/.test(q.get('c') || '') && /^(t|s)$/.test(q.get('r') || '')) return raw; // كود الحصة — الموقع بيدوّر على الحصة
  if (q.get('tj') && q.get('r') === 't') return raw; // لينك «جدولي» للمعلم
  return q.get('s') && q.get('k') && /^(t|s)$/.test(q.get('r') || '') ? raw : null;
}
const HOME = path.join(__dirname, 'home.html');
const loadHome = w => w.loadFile(HOME);

/* ---------- نافذة واحدة لكل حصة ---------- */
function createWindow(url) {
  const win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600, show: false,
    title: 'Itqan Academy', icon: path.join(__dirname, 'build', 'icon.png'), backgroundColor: '#0e1a2b',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false,          // الحصة ماتقفش لما النافذة تتصغّر أو تروح ورا
      autoplayPolicy: 'no-user-gesture-required', // الصوت يشتغل من غير «اضغط لتفعيل الصوت»
      spellcheck: false
    }
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // روابط خارج الموقع (واتساب، Drive...) تفتح في المتصفح، وروابط الموقع تفتح نافذة جديدة في التطبيق
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (isSite(u)) { createWindow(u); return { action: 'deny' }; }
    if (/^(https?|mailto):/i.test(u)) shell.openExternal(u);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, u) => {
    if (isSite(u) || u.startsWith('file:')) return;
    e.preventDefault(); if (/^(https?|mailto):/i.test(u)) shell.openExternal(u);
  });

  // التأكيد قبل قفل النافذة والحصة شغّالة أو التسجيل بيترفع (Electron مابيعرضش رسالة المتصفح لوحده)
  win.webContents.on('will-prevent-unload', e => {
    const r = dialog.showMessageBoxSync(win, {
      type: 'question', buttons: ['البقاء في الحصة', 'خروج'], defaultId: 0, cancelId: 0,
      title: 'Itqan Academy', message: 'فيه حصة شغّالة أو تسجيل لسه بيترفع.', detail: 'متأكد إنك عايز تقفل الصفحة؟'
    });
    if (r === 1) e.preventDefault();
  });

  // لو مفيش نت: صفحة «حاول تاني»
  win.webContents.on('did-fail-load', (e, code, desc, failedUrl, isMain) => {
    if (!isMain || code === -3) return; // -3 = اتلغى (تنقّل عادي)
    if (!isSite(failedUrl)) return loadHome(win);
    win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: failedUrl } });
  });

  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    if (i.key === 'F5' || ((i.control || i.meta) && i.key.toLowerCase() === 'r')) { win.webContents.reload(); e.preventDefault(); }
  });

  /* المعلم عنده «جدولي» على البرنامج ← البرنامج يفتح على شاشة حصصي وجدولي على طول (عشان الفتح التلقائي قبل الميعاد) */
  url ? win.loadURL(url) : (homeSite() ? win.loadURL(SITE + (SITE.includes('?') ? '&' : '?') + 'app=1') : loadHome(win));
  return win;
}

/* ---------- الصلاحيات: ميكروفون/كاميرا/إشعارات/نسخ — للموقع بتاعنا بس ---------- */
function setupSession() {
  const ses = session.defaultSession;
  const ALLOW = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'display-capture', 'speaker-selection']);
  ses.setPermissionRequestHandler((wc, perm, cb, details) => cb(ALLOW.has(perm) && isSite(details.requestingUrl || wc.getURL())));
  ses.setPermissionCheckHandler((wc, perm, origin) => ALLOW.has(perm) && isSite(origin || (wc && wc.getURL()) || ''));

  // مشاركة الشاشة: نافذة اختيار (الشاشة كلها أو نافذة معيّنة) + صوت الكمبيوتر على ويندوز
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: false });
      const parent = BrowserWindow.fromWebContents(request.frame && request.frame.top ? webContentsOf(request.frame) : null) || BrowserWindow.getFocusedWindow();
      const pick = await showPicker(parent, sources);
      if (!pick) return callback({});
      const src = sources.find(s => s.id === pick.id);
      if (!src) return callback({});
      lastPick = { screen: src.id.startsWith('screen:'), displayId: src.display_id };
      const res = { video: src };
      if (request.audioRequested && pick.audio && process.platform === 'win32') res.audio = 'loopback';
      callback(res);
    } catch (e) { callback({}); }
  });
}
function webContentsOf(frame) { try { return require('electron').webContents.fromFrame(frame.top); } catch (e) { return null; } }

function showPicker(parent, sources) {
  return new Promise(resolve => {
    const w = new BrowserWindow({
      parent: parent || undefined, modal: !!parent, width: 760, height: 560, resizable: true, minimizable: false, maximizable: false,
      title: 'اختار اللي عايز تشاركه', backgroundColor: '#0e1a2b', autoHideMenuBar: true, show: false,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
    });
    let done = false;
    const finish = v => { if (done) return; done = true; ipcMain.removeHandler('picker:get'); ipcMain.removeAllListeners('picker:done'); resolve(v); if (!w.isDestroyed()) w.close(); };
    ipcMain.handle('picker:get', () => sources.map(s => ({ id: s.id, name: s.name, screen: s.id.startsWith('screen:'), thumb: s.thumbnail.toDataURL() })));
    ipcMain.on('picker:done', (e, v) => finish(v && typeof v.id === 'string' ? { id: v.id, audio: !!v.audio } : null));
    w.on('closed', () => finish(null));
    w.once('ready-to-show', () => w.show());
    w.loadFile(path.join(__dirname, 'picker.html'));
  });
}

/* ---------- شاشة البداية (دخول المعلم / دخول الطالب) ---------- */
/* آخر حصة: الموقع بيبلّغ بيها وهو جوه الحصة، وبتتمسح لما الحصة تخلص — صالحة 3 ساعات من آخر تواجد */
const LAST = () => path.join(app.getPath('userData'), 'last-class.json');
ipcMain.on('last:set', (e, o) => {
  if (!isSite(e.sender.getURL())) return;
  try {
    if (!o) return require('fs').rmSync(LAST(), { force: true });
    if (!inviteUrl(o.u) || !/^(t|s)$/.test(o.r) || !/^[a-z0-9]{4,16}$/.test(o.room)) return;
    require('fs').writeFileSync(LAST(), JSON.stringify({ u: o.u, room: o.room, r: o.r, ts: Date.now() }));
  } catch (x) {}
});
ipcMain.handle('last:get', () => {
  try { const o = JSON.parse(require('fs').readFileSync(LAST(), 'utf8')); return o && inviteUrl(o.u) && Date.now() - o.ts < 3 * 36e5 ? o : null; } catch (x) { return null; }
});
ipcMain.handle('clip:read', () => clipboard.readText());
const HOMEF = () => path.join(app.getPath('userData'), 'home-site');
const homeSite = () => { try { return require('fs').existsSync(HOMEF()); } catch (e) { return false; } };
ipcMain.on('home:site', (e, on) => { if (!isSite(e.sender.getURL())) return; try { on ? require('fs').writeFileSync(HOMEF(), '1') : require('fs').rmSync(HOMEF(), { force: true }); } catch (x) {} });
/* شاشة البداية بتاعة الموقع (حصصي + جدولي + الفتح التلقائي قبل الميعاد) */
ipcMain.handle('site:home', e => { const w = BrowserWindow.fromWebContents(e.sender); const u = SITE + (SITE.includes('?') ? '&' : '?') + 'app=1'; w ? w.loadURL(u) : createWindow(u); return true; });
ipcMain.handle('invite:open', (e, raw, role) => {
  /* كود الحصة (4 حروف وأرقام) بدل الرابط */
  const c = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!/^https?:|^itqan:/i.test(String(raw || '').trim()) && /^([a-z0-9]{4}|[a-z0-9]{6})$/.test(c) && /^(t|s)$/.test(role || '')) raw = SITE + (SITE.includes('?') ? '&' : '?') + 'c=' + c + '&r=' + role;
  const u = inviteUrl(raw);
  if (!u) return false;
  const w = BrowserWindow.fromWebContents(e.sender);
  w ? w.loadURL(u) : createWindow(u);
  return true;
});

/* ---------- الرسم على الشاشة المشاركة (زي Zoom) ----------
   لما المعلم/الطالب يشارك الشاشة كلها: زر قلم عايم ✏️ فوق كل البرامج. الضغط عليه بيفتح طبقة رسم شفافة فوق الشاشة
   + شريط أدوات. الرسم نفسه بيتصوّر في الشاشة المشاركة فالطلاب بيشوفوه، أما الزر والشريط مستخبيين عن المشاركة. */
let lastPick = null;
const ANN = { pen: null, ov: null, tb: null, on: false, owner: null };
const annWin = k => ANN[k] && !ANN[k].isDestroyed() ? ANN[k] : null;
function annDisplay() { const ds = screen.getAllDisplays(); return (lastPick && ds.find(d => String(d.id) === String(lastPick.displayId))) || screen.getPrimaryDisplay(); }
function annTop(w) { w.setAlwaysOnTop(true, 'screen-saver'); try { w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (e) {} }
function annMake(opts, file, hideFromShare) {
  const w = new BrowserWindow({ frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
    skipTaskbar: true, hasShadow: false, show: false, backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false }, ...opts });
  annTop(w); if (hideFromShare) { try { w.setContentProtection(true); } catch (e) {} }
  w.loadFile(path.join(__dirname, file)); return w;
}
function annStart(owner) {
  annStop(); ANN.owner = owner; const b = annDisplay().bounds;
  ANN.ov = annMake({ x: b.x, y: b.y, width: b.width, height: b.height, enableLargerThanScreen: true }, 'annotate.html', false);
  ANN.ov.setIgnoreMouseEvents(true); ANN.ov.once('ready-to-show', () => annWin('ov') && ANN.ov.showInactive());
  const tw = Math.min(760, b.width - 20);
  ANN.tb = annMake({ width: tw, height: 60, x: b.x + Math.round((b.width - tw) / 2), y: b.y + 14 }, 'anntools.html', true);
  ANN.pen = annMake({ width: 64, height: 64, x: b.x + b.width - 96, y: b.y + b.height - 170, focusable: false }, 'annpen.html', true);
  ANN.pen.once('ready-to-show', () => annWin('pen') && ANN.pen.showInactive());
  owner.once('closed', () => { if (ANN.owner === owner) annStop(); });
}
function annMode(on) {
  const ov = annWin('ov'), tb = annWin('tb'), pen = annWin('pen'); if (!ov) return;
  ANN.on = !!on; ov.setIgnoreMouseEvents(!ANN.on);
  if (ANN.on) { ov.show(); ov.focus(); if (tb) { tb.show(); tb.moveTop(); } if (pen) pen.moveTop(); } else if (tb) tb.hide();
  [ov, pen].forEach(w => w && w.webContents.send('ann', { t: 'mode', on: ANN.on }));
}
function annStop() { ['tb', 'pen', 'ov'].forEach(k => { const w = annWin(k); if (w) w.destroy(); ANN[k] = null; }); ANN.on = false; ANN.owner = null; }
ipcMain.on('ann', (e, m) => {
  if (!m || typeof m.t !== 'string') return;
  if (m.t === 'toggle') return annMode(!ANN.on);
  if (m.t === 'close') return annMode(false);
  if (['tool', 'color', 'width', 'undo', 'clear'].includes(m.t)) { const ov = annWin('ov'); if (ov) ov.webContents.send('ann', m); return; }
  if (m.t === 'state') { const tb = annWin('tb'); if (tb) tb.webContents.send('ann', m); }
});
/* الصفحة بتبلّغ لما مشاركة الشاشة تبدأ أو تقف */
ipcMain.on('share', (e, on) => {
  const w = BrowserWindow.fromWebContents(e.sender); if (!w) return;
  if (on && lastPick && lastPick.screen) { if (!annWin('ov') || ANN.owner !== w) annStart(w); }
  else if (!on && ANN.owner === w) annStop();
});

/* ---------- prompt() — Electron مابيدعموش، فبنعمل نافذة صغيرة بنفس الشكل ---------- */
ipcMain.on('prompt', (event, msg, def) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const w = new BrowserWindow({
    parent, modal: true, width: 460, height: 210, resizable: false, minimizable: false, maximizable: false,
    title: 'Itqan Academy', backgroundColor: '#14283f', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  let answered = false;
  const answer = v => { if (answered) return; answered = true; event.returnValue = v; ipcMain.removeHandler('prompt:get'); ipcMain.removeAllListeners('prompt:done'); if (!w.isDestroyed()) w.close(); };
  ipcMain.handle('prompt:get', () => ({ msg: String(msg || ''), def: String(def || '') }));
  ipcMain.on('prompt:done', (e, v) => answer(v === null ? null : String(v)));
  w.on('closed', () => answer(null));
  w.once('ready-to-show', () => w.show());
  w.loadFile(path.join(__dirname, 'prompt.html'));
});

/* منع الكمبيوتر من النوم طول ما فيه نافذة مفتوحة (الحصة أو لوحة السكرتارية) */
let psb = null;
function keepAwake() { if (psb === null) psb = powerSaveBlocker.start('prevent-display-sleep'); }

/* ---------- القائمة ---------- */
function openInviteDialog() {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!win) return;
  win.webContents.executeJavaScript("window.prompt('الصق رابط الدعوة اللي وصلك من السكرتارية:','')").then(v => {
    if (v == null || !String(v).trim()) return;
    const u = inviteUrl(v);
    if (!u) return dialog.showMessageBox(win, { type: 'warning', message: 'الرابط ده مش رابط دعوة من أكاديمية إتقان.', detail: 'انسخ الرابط كامل من رسالة السكرتارية وجرّب تاني.' });
    createWindow(u);
  }).catch(() => {});
}
function buildMenu() {
  const tpl = [
    { label: 'التطبيق', submenu: [
      { label: 'الصفحة الرئيسية', accelerator: 'Alt+Home', click: () => { const w = BrowserWindow.getFocusedWindow(); w ? loadHome(w) : createWindow(); } },
      { label: 'فتح رابط دعوة…', accelerator: 'CmdOrCtrl+L', click: openInviteDialog },
      { label: 'نافذة جديدة (حصة تانية)', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
      { type: 'separator' },
      { label: 'إعادة تحميل', accelerator: 'F5', click: () => { const w = BrowserWindow.getFocusedWindow(); w && w.webContents.reload(); } },
      { label: 'ملء الشاشة', accelerator: 'F11', click: () => { const w = BrowserWindow.getFocusedWindow(); w && w.setFullScreen(!w.isFullScreen()); } },
      { type: 'separator' },
      { label: 'خروج', role: 'quit' }
    ]},
    { label: 'تعديل', submenu: [
      { label: 'تراجع', role: 'undo' }, { label: 'إعادة', role: 'redo' }, { type: 'separator' },
      { label: 'قص', role: 'cut' }, { label: 'نسخ', role: 'copy' }, { label: 'لصق', role: 'paste' }, { label: 'تحديد الكل', role: 'selectAll' }
    ]},
    { label: 'عرض', submenu: [
      { label: 'تكبير', role: 'zoomIn' }, { label: 'تصغير', role: 'zoomOut' }, { label: 'الحجم الأصلي', role: 'resetZoom' },
      { type: 'separator' }, { label: 'أدوات المطوّر', role: 'toggleDevTools' }
    ]},
    { label: 'مساعدة', submenu: [
      { label: 'عن التطبيق', click: () => dialog.showMessageBox({ type: 'info', title: 'Itqan Academy', message: 'أكاديمية إتقان — تطبيق الكمبيوتر', detail: 'إصدار التطبيق: ' + app.getVersion() + '\nالموقع: ' + SITE + '\n\nالتطبيق بيفتح نسخة الموقع الحالية، فأي تحديث للموقع بيوصل لوحده.' }) },
      { label: 'فتح الموقع في المتصفح', click: () => shell.openExternal(SITE) },
      { label: 'التحقق من وجود تحديث', click: () => checkUpdate(true) }
    ]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------- التحديث: التطبيق مابيتحدّثش لوحده، فبنقول للمستخدم لما يكون فيه إصدار جديد ---------- */
const DL = 'https://github.com/itqanacademyalex-ai/Itqan.Academy/releases/latest/download/ItqanAcademy-Setup.exe';
const newer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
async function checkUpdate(manual) {
  try {
    const { net } = require('electron');
    const r = await net.fetch('https://api.github.com/repos/itqanacademyalex-ai/Itqan.Academy/releases/latest', { headers: { 'User-Agent': 'ItqanAcademy' } });
    const j = await r.json(), v = String(j.tag_name || '').replace(/^desktop-v/, '');
    if (/^\d+\.\d+\.\d+$/.test(v) && newer(v, app.getVersion())) {
      const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      const { response } = await dialog.showMessageBox(w, { type: 'info', title: 'Itqan Academy', buttons: ['تحميل التحديث', 'بعدين'], defaultId: 0, cancelId: 1,
        message: 'فيه إصدار جديد من تطبيق إتقان (' + v + ')', detail: 'إصدارك الحالي ' + app.getVersion() + '. نزّل التحديث وثبّته فوق القديم — الحصص والإعدادات مش هتتأثر.' });
      if (response === 0) shell.openExternal(DL);
    } else if (manual) dialog.showMessageBox({ type: 'info', title: 'Itqan Academy', message: 'عندك أحدث إصدار (' + app.getVersion() + ') ✓' });
  } catch (e) { if (manual) dialog.showMessageBox({ type: 'warning', title: 'Itqan Academy', message: 'تعذّر التحقق من التحديث — اتأكد من الإنترنت.' }); }
}

/* ---------- روابط itqan:// (زر «افتح في تطبيق إتقان» في الموقع) + نسخة واحدة من التطبيق ---------- */
if (process.defaultApp) {
  if (process.argv.length >= 2) app.setAsDefaultProtocolClient(PROTO, process.execPath, [path.resolve(process.argv[1])]);
} else app.setAsDefaultProtocolClient(PROTO);

const fromArgv = argv => { for (const a of argv || []) { const u = inviteUrl(a); if (u) return u; } return null; };

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const u = fromArgv(argv);
    if (u) return createWindow(u);
    const w = BrowserWindow.getAllWindows()[0];
    if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else createWindow();
  });
  app.on('open-url', (e, url) => { e.preventDefault(); const u = inviteUrl(url); if (app.isReady()) createWindow(u); else app.once('ready', () => createWindow(u)); });

  app.whenReady().then(() => {
    setupSession(); buildMenu(); keepAwake();
    createWindow(fromArgv(process.argv));
    setTimeout(() => checkUpdate(false), 8000);
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
