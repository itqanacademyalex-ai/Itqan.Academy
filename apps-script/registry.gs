/**
 * سجل حصص أكاديمية إتقان (Google Apps Script)
 * - المواعيد بتتقري مباشرة من شيت السيستم (تاب «المجموعات»): الحصص الأونلاين النشطة بس.
 *   كل صف لازم يبقى فيه «كود الحصة» (كود إتقان، زي g9sb) في عمود عنوانه «كود الحصة».
 * - لوحة السكرتارية بترفع هنا بصمة كود المعلم لكل غرفة (مرة واحدة)، عشان نتأكد إن كود المعلم صح.
 * - جهاز المعلم بيسأل هنا قبل ما يفتح الحصة: الكود صح؟ والوقت من قبل الحصة بـ 10 دقايق لحد ما تخلص؟ (بتوقيت القاهرة)
 *
 * التحديث: الصق الكود ده مكان القديم ← Deploy ← Manage deployments ← ✏️ ← Version: New version ← Deploy (الرابط مايتغيّرش).
 */
const KEY = 'PUT-YOUR-SECRET-KEY-HERE';        // نفس المفتاح اللي بيتكتب في لوحة السكرتارية
const SHEET_ID = '19rntbEVyZw4z61r9IE9NuNztwLd0rQti-uZmn4RAavs'; // من رابط الشيت: بين /d/ و /edit
const TAB = 'المجموعات';
const TZ = 'Africa/Cairo';
const EARLY = 10;  // المعلم يقدر يفتح قبل الحصة بالدقايق دي بس
const DUR = 120;    // مدة الحصة بالدقايق (لو مفيش عمود «المدة» في الشيت)

const DAYS = { 'الأحد': 0, 'الاحد': 0, 'الإثنين': 1, 'الاثنين': 1, 'الإتنين': 1, 'الثلاثاء': 2, 'التلات': 2, 'الأربعاء': 3, 'الاربعاء': 3, 'الخميس': 4, 'الجمعة': 5, 'السبت': 6 };

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function load_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('rooms') || '{}'); } catch (e) { return {}; } }
function min_(t) { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
const norm_ = s => String(s || '').replace(/[ً-ْـ]/g, '').trim();

/* «3:30 ظهرًا» / «4:00 مساء» / «11:00 صباحا» / «18:00» ← «HH:mm» */
function time_(v) {
  const s = norm_(v), m = s.match(/(\d{1,2})[:.](\d{2})/) || s.match(/(\d{1,2})/);
  if (!m) return '';
  let h = +m[1]; const mi = m[2] && m[2].length == 2 ? +m[2] : 0;
  if (/مساء|(^|\s)م(\s|$)|pm/i.test(s) && h < 12) h += 12;
  else if (/ظهر|عصر/.test(s) && h <= 6) h += 12;
  else if (/صباح|(^|\s)ص(\s|$)|am/i.test(s) && h == 12) h = 0;
  return ('0' + h).slice(-2) + ':' + ('0' + mi).slice(-2);
}

/* المواعيد من الشيت: { كود_الحصة: [[يوم, 'HH:mm', مدة], ...] } — بتتخزن دقيقة عشان السرعة */
function sheet_() {
  const C = CacheService.getScriptCache(), hit = C.get('sch');
  if (hit) return JSON.parse(hit);
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  const V = sh.getDataRange().getDisplayValues(), H = V[0].map(norm_), R = {};
  const col = re => H.findIndex(h => re.test(h));
  const cCode = col(/كود الحصة/), cType = col(/نوع/), cTime = col(/^الوقت/), cState = col(/الحالة/), cDur = col(/المدة/);
  const dayCols = [];
  H.forEach((h, i) => { const d = DAYS[h]; if (d !== undefined) dayCols.push([i, d]); });
  if (cCode < 0 || cTime < 0) return {};
  for (let r = 1; r < V.length; r++) {
    const row = V[r], code = String(row[cCode] || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4,6}$/.test(code)) continue;
    if (cType >= 0 && !/ونلاين|online/i.test(row[cType])) continue;
    if (cState >= 0 && row[cState] && !/نشط/.test(row[cState])) continue;
    const t = time_(row[cTime]); if (!t) continue;
    const dur = cDur >= 0 && +row[cDur] > 0 ? +row[cDur] : DUR;
    dayCols.forEach(([i, d]) => { if (/^(true|نعم|✓|✔|1)$/i.test(String(row[i]).trim())) (R[code] = R[code] || []).push([d, t, dur]); });
  }
  C.put('sch', JSON.stringify(R), 60);
  return R;
}

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a === 'chk') {
    const c = String(p.c || '').toLowerCase(), r = load_()[c] || {};
    let S = null; try { S = sheet_()[c] || null; } catch (x) { S = null; }
    /* جدول السكرتارية (من لوحة التطبيق) ليه الأولوية، والشيت احتياطي */
    const s = (r.s && r.s.length) ? r.s : (S || []);
    const now = new Date(), d = Number(Utilities.formatDate(now, TZ, 'u')) % 7; // 0 = الأحد
    const hm = Utilities.formatDate(now, TZ, 'HH:mm'), n = min_(hm);
    if (!r.v && !s.length) return out_({ ok: true, known: false, now: hm, d: d });
    /* ميعاد ليه تاريخ (حصة استثنائية) بيشتغل في اليوم ده بس */
    const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
    const allow = s.some(q => (q[3] ? q[3] === today : +q[0] === d) && n >= min_(q[1]) - EARLY && n < min_(q[1]) + (+q[2] || DUR));
    return out_({ ok: true, known: true, v: r.v || '', allow: allow, s: s, now: hm, d: d, today: today, src: (r.s && r.s.length) ? 'app' : 'sheet' });
  }
  /* حصص معلم واحد (لـ «حصصي» عند المعلم): بالاسم، أو باسم معلم الغرفة c */
  if (p.a === 'tl') {
    const all = load_(); let n = String(p.n || '').trim(); const c = String(p.c || '').toLowerCase();
    if (!n && c && all[c]) n = all[c].t || '';
    const R = {}; if (n) Object.keys(all).forEach(k => { const r = all[k]; if (r.t === n && (r.s || []).length) R[k] = { t: r.t, n: r.n || '', v: r.v || '', s: r.s }; });
    return out_({ ok: true, rooms: R });
  }
  /* غرف السكرتارية المتشفّرة (بكلمة سر السكرتارية) — للمزامنة بين أجهزة السكرتارية */
  if (p.a === 'fxget') {
    const P = PropertiesService.getScriptProperties(), n = +(P.getProperty('fxb_n') || 0); let d = '';
    for (let i = 0; i < n; i++) d += P.getProperty('fxb_' + i) || '';
    return out_({ ok: true, d: d, t: +(P.getProperty('fxb_t') || 0) });
  }
  /* مكتبة المجموعة: كل حصة (فولدر بالتاريخ) والملفات اللي فيها — الأحدث الأول */
  if (p.a === 'lib') {
    const c = String(p.c || '').toLowerCase(); if (!/^[a-z0-9]{4,6}$/.test(c)) return out_({ ok: false });
    const C = CacheService.getScriptCache(), hit = C.get('lib_' + c); if (hit) return out_({ ok: true, items: JSON.parse(hit) });
    const id = PropertiesService.getScriptProperties().getProperty('gf_' + c); if (!id) return out_({ ok: true, items: [] });
    const out = []; try { const it = DriveApp.getFolderById(id).getFolders();
      while (it.hasNext()) { const f = it.next(), files = [], fi = f.getFiles(); while (fi.hasNext()) { const x = fi.next(); const mt = x.getMimeType(), nm = x.getName(); if (/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) files.push({ n: nm, id: x.getId(), m: mt, s: x.getSize() }); } if (files.length) out.push({ d: f.getName(), files: files }); }
    } catch (x) { return out_({ ok: false, e: String(x) }); }
    out.sort((a, b) => a.d < b.d ? 1 : -1); const j = JSON.stringify(out); if (j.length < 95000) C.put('lib_' + c, j, 300);
    return out_({ ok: true, items: out });
  }
  if (p.a === 'list') { try { return out_({ ok: true, rooms: sheet_() }); } catch (x) { return out_({ ok: false, e: String(x) }); } }
  return out_({ ok: false });
}

function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { return out_({ ok: false, e: 'json' }); }
  /* رفع التسجيل والملفات (زي سكربت التسجيل: من غير المفتاح) */
  if (b.a === 'start') return upStart_(b);
  if (b.a === 'chunk') return upChunk_(b);
  if (b.a === 'status') return upStatus_(b);
  if (b.k !== KEY) return out_({ ok: false, e: 'key' });
  if (b.a === 'fxput') {
    const d = String(b.d || ''); if (!/^[A-Za-z0-9_-]{20,400000}$/.test(d)) return out_({ ok: false, e: 'data' });
    const P = PropertiesService.getScriptProperties(), old = +(P.getProperty('fxb_n') || 0), parts = [];
    for (let i = 0; i < d.length; i += 8000) parts.push(d.slice(i, i + 8000));
    const o = { fxb_n: String(parts.length), fxb_t: String(Date.now()) }; parts.forEach((x, i) => o['fxb_' + i] = x);
    P.setProperties(o); for (let i = parts.length; i < old; i++) P.deleteProperty('fxb_' + i);
    return out_({ ok: true, n: parts.length });
  }
  if (b.a === 'put') {
    const R = {};
    (b.rooms || []).slice(0, 300).forEach(r => {
      const c = String(r.c || '').toLowerCase();
      if (!/^[a-z0-9]{4,6}$/.test(c)) return;
      R[c] = { v: String(r.v || '').slice(0, 20), t: String(r.t || '').slice(0, 40), n: String(r.n || '').slice(0, 60), s: (r.s || []).filter(q => Array.isArray(q) && q[0] >= 0 && q[0] <= 6 && /^\d{1,2}:\d{2}$/.test(q[1])).slice(0, 30).map(q => /^\d{4}-\d{2}-\d{2}$/.test(q[3] || '') ? [+q[0], q[1], +q[2] || DUR, q[3]] : [+q[0], q[1], +q[2] || DUR]) };
    });
    PropertiesService.getScriptProperties().setProperty('rooms', JSON.stringify(R));
    return out_({ ok: true, n: Object.keys(R).length });
  }
  return out_({ ok: false });
}

/* اضغط ▶ Run على الدالة دي من المحرر عشان تشوف الحصص اللي اتقرت من الشيت (في Execution log) */
function test() { CacheService.getScriptCache().remove('sch'); Logger.log(JSON.stringify(sheet_(), null, 1)); }

/* ▶ Run مرة واحدة: بتكتب أكواد الغرف في عمود «كود الحصة» للمجموعات الأونلاين النشطة اللي لسه مالهاش كود،
   بالترتيب، من غير ما تكرر كود متكتب قبل كده. وفي Execution log بتكتب كل مجموعة خدت أنهي غرفة. */
const CODES = []; // أكواد الغرف بالترتيب (غرفة 1، غرفة 2، ...)
function fillCodes() {
  const sh = SpreadsheetApp.openById(SHEET_ID).getSheetByName(TAB);
  const V = sh.getDataRange().getDisplayValues(), H = V[0].map(norm_);
  let cCode = H.findIndex(h => /كود الحصة/.test(h));
  if (cCode < 0) { cCode = H.length; sh.getRange(1, cCode + 1).setValue('كود الحصة'); }
  const cGrp = H.findIndex(h => /كود المجموعة/.test(h)), cT = H.findIndex(h => /المدرس/.test(h)), cType = H.findIndex(h => /نوع/.test(h)), cState = H.findIndex(h => /الحالة/.test(h));
  const used = new Set(V.slice(1).map(r => String(r[cCode] || '').trim().toLowerCase()).filter(Boolean));
  const free = CODES.map(c => c.toLowerCase()).filter(c => !used.has(c));
  const log = [];
  for (let r = 1; r < V.length && free.length; r++) {
    const row = V[r];
    if (String(row[cCode] || '').trim()) continue;
    if (cType >= 0 && !/ونلاين|online/i.test(row[cType])) continue;
    if (cState >= 0 && row[cState] && !/نشط/.test(row[cState])) continue;
    const c = free.shift();
    sh.getRange(r + 1, cCode + 1).setValue(c);
    log.push('صف ' + (r + 1) + ' | ' + (cGrp >= 0 ? row[cGrp] : '') + ' | ' + (cT >= 0 ? row[cT] : '') + '  ←  ' + c + ' (غرفة ' + (CODES.map(x => x.toLowerCase()).indexOf(c) + 1) + ')');
  }
  CacheService.getScriptCache().remove('sch');
  Logger.log(log.length ? log.join('\n') : 'مفيش مجموعات أونلاين محتاجة كود');
  if (free.length) Logger.log('أكواد لسه ما اتوزعتش: ' + free.join(', '));
}

/* ===== التسجيل والملفات على Drive: فولدر «تسجيلات أكاديمية إتقان»، وجواه فولدر لكل حصة
   (الفيديو + السبورة PDF + التفريغ + الملفات المشاركة). الرفع على أجزاء (Drive resumable upload). ===== */
const ROOT = 'تسجيلات أكاديمية إتقان';
/* «المجموعة/التاريخ» ← فولدر المجموعة وجواه فولدر الحصة */
function folder_(name) {
  const it = DriveApp.getFoldersByName(ROOT); let f = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT);
  String(name || '').split('/').map(x => x.replace(/[\\:*?"<>|]/g, '_').trim().slice(0, 120)).filter(Boolean).slice(0, 3).forEach(n => {
    const s = f.getFoldersByName(n); f = s.hasNext() ? s.next() : f.createFolder(n);
  });
  return f;
}
function upStart_(b) {
  const f = folder_(b.f), c = String(b.c || '').toLowerCase();
  /* المكتبة: فولدر المجموعة بتاع الغرفة دي */
  if (/^[a-z0-9]{4,6}$/.test(c) && String(b.f || '').indexOf('/') > 0) { try { const g = f.getParents(); if (g.hasNext()) PropertiesService.getScriptProperties().setProperty('gf_' + c, g.next().getId()); } catch (x) {} } meta = { name: String(b.name || 'ملف').slice(0, 200), mimeType: String(b.mime || 'application/octet-stream').split(';')[0], parents: [f.getId()] };
  const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': meta.mimeType }, muteHttpExceptions: true });
  const h = r.getHeaders(), loc = h['Location'] || h['location'];
  if (!loc) return out_({ ok: false, e: 'start ' + r.getResponseCode() });
  const s = Utilities.getUuid(); CacheService.getScriptCache().put('up_' + s, loc, 21600); if (/^[a-z0-9]{4,6}$/.test(c)) CacheService.getScriptCache().put('upc_' + s, c, 21600);
  return out_({ ok: true, s: s });
}
function upChunk_(b) {
  const loc = CacheService.getScriptCache().get('up_' + b.s); if (!loc) return out_({ ok: false, e: 'session' });
  const bytes = b.d ? Utilities.base64Decode(b.d) : null;
  const range = bytes && bytes.length ? 'bytes ' + b.st + '-' + b.en + '/' + b.tot : 'bytes */' + b.tot;
  const r = UrlFetchApp.fetch(loc, { method: 'put', contentType: String(b.m || 'application/octet-stream').split(';')[0], payload: bytes || '', headers: { 'Content-Range': range }, muteHttpExceptions: true });
  const c = r.getResponseCode();
  if (c == 308) return out_({ ok: true, done: 0 });
  if (c == 200 || c == 201) { let id = ''; try { id = JSON.parse(r.getContentText()).id; } catch (x) {} const C = CacheService.getScriptCache(), rc = C.get('upc_' + b.s); C.remove('up_' + b.s);
    /* الملف يتفتح لأي حد معاه لينك المجموعة (من المكتبة) */
    /* الفيديو والسبورة بس بيتفتحوا باللينك (الملخص والتفريغ بيفضلوا خاصين بالإدارة) */
    if (id) { try { const fl = DriveApp.getFileById(id), mt = fl.getMimeType(), nm = fl.getName(); if (/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) fl.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (x) {} }
    if (rc) C.remove('lib_' + rc);
    return out_({ ok: true, done: 1, id: id }); }
  return out_({ ok: false, e: 'chunk ' + c });
}
function upStatus_(b) {
  const loc = CacheService.getScriptCache().get('up_' + b.s); if (!loc) return out_({ ok: false, e: 'session' });
  const r = UrlFetchApp.fetch(loc, { method: 'put', payload: '', headers: { 'Content-Range': 'bytes */*' }, muteHttpExceptions: true });
  const g = (r.getHeaders()['Range'] || r.getHeaders()['range'] || ''), m = /bytes=0-(\d+)/.exec(g);
  return out_({ ok: true, r: m ? +m[1] + 1 : 0 });
}
/* ▶ Run مرة واحدة بعد التحديث: بتدّي السكربت صلاحية Drive وبتعمل الفولدر الرئيسي */
function authDrive() { folder_(''); UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }); Logger.log('تمام — فولدر «' + ROOT + '» جاهز'); }
