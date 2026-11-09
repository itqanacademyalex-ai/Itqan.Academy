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

/* أي غلط جوه السكربت بيرجع رسالة واضحة (JSON) بدل صفحة جوجل «unable to open the file» */
function doGet(e) { try { return doGet_(e); } catch (x) { return out_({ ok: false, e: 'server: ' + (x && x.message || x) }); } }
function doPost(e) { try { return doPost_(e); } catch (x) { return out_({ ok: false, e: 'server: ' + (x && x.message || x) }); } }
function doGet_(e) {
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
      while (it.hasNext()) { const f = it.next(), files = [], fi = f.getFiles(); while (fi.hasNext()) { const x = fi.next(); const mt = x.getMimeType(), nm = x.getName(); if (/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) files.push({ n: nm, id: x.getId(), m: mt, s: x.getSize() }); } const hw = jget_(f, 'hw.json'), it2 = { d: f.getName(), files: files }; if (hw && hw.st == 'pub') it2.hw = pubHw_(hw); if (files.length || it2.hw) out.push(it2); }
    } catch (x) { return out_({ ok: false, e: String(x) }); }
    out.sort((a, b) => a.d < b.d ? 1 : -1); const j = JSON.stringify(out); if (j.length < 95000) C.put('lib_' + c, j, 21600); // بيتمسح لوحده أول ما ملف جديد يترفع أو واجب يتنشر
    return out_({ ok: true, items: out });
  }
  if (p.a === 'list') { try { return out_({ ok: true, rooms: sheet_() }); } catch (x) { return out_({ ok: false, e: String(x) }); } }
  return out_({ ok: false });
}

function doPost_(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { return out_({ ok: false, e: 'json' }); }
  /* رفع التسجيل والملفات (زي سكربت التسجيل: من غير المفتاح) */
  /* المكتبة كمان بـ POST — بعض المتصفحات/الشبكات طلب GET بتاعها مابيوصلش للسكربت */
  if (b.a === 'lib') return doGet_({ parameter: { a: 'lib', c: b.c } });
  if (b.a === 'pdf') return pdf_(b);
  if (b.a === 'hwgen') return hwGen_(b);
  if (b.a === 'hwpub') return hwPub_(b);
  if (b.a === 'hwsub') return hwSub_(b);
  if (b.a === 'hwlist') return hwList_(b);
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
      R[c] = { v: String(r.v || '').slice(0, 20), h: /^[a-f0-9]{64}$/.test(r.h || '') ? r.h : '', t: String(r.t || '').slice(0, 40), n: String(r.n || '').slice(0, 60), s: (r.s || []).filter(q => Array.isArray(q) && q[0] >= 0 && q[0] <= 6 && /^\d{1,2}:\d{2}$/.test(q[1])).slice(0, 30).map(q => /^\d{4}-\d{2}-\d{2}$/.test(q[3] || '') ? [+q[0], q[1], +q[2] || DUR, q[3]] : [+q[0], q[1], +q[2] || DUR]) };
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

/* اختبار المكتبة من المحرر: شغّلها وشوف النتيجة في Execution log */
function testLib() { Logger.log(doGet({ parameter: { a: 'lib', c: 'hhe8' } }).getContent()); }

/* ===== 📝 الواجب التلقائي من السبورة (Gemini) — المفتاح في Script Properties باسم GEMINI_KEY، مابيوصلش لأي جهاز =====
   hwgen: مسودة 10 أسئلة من سبورة الحصة وتفريغها ← المعلم يراجع ← hwpub: ينشر (والإجابات النموذجية ملف للمعلم بس)
   hwsub: الطالب يحل ← تصحيح تلقائي (الاختيارات بالمقارنة، والكتابي بالذكاء الاصطناعي) ← hwres: النتايج للمعلم */
/* الموديل: GEMINI_MODEL في Script Properties لو حابب تحدده بنفسك، وإلا السكربت بيختار لوحده أحدث موديل «flash» متاح لمفتاحك
   (جوجل بتقفل الموديلات القديمة للحسابات الجديدة — زي gemini-2.5-flash — فلو الموديل رجّع 404 بنختار غيره ونحفظه) */
const GEM_ = () => PropertiesService.getScriptProperties().getProperty('GEMINI_KEY') || '';
function gemModel_() { const P = PropertiesService.getScriptProperties(); return P.getProperty('GEMINI_MODEL') || P.getProperty('gem_model') || gemPick_(); }
function gemPick_() {
  const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(GEM_()), { muteHttpExceptions: true });
  if (r.getResponseCode() != 200) throw new Error('Gemini models ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 160));
  const ver = n => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? +m[1] : 0; };
  const L = (JSON.parse(r.getContentText()).models || []).filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') > -1)
    .map(m => String(m.name || '').replace(/^models\//, '')).filter(n => /^gemini-[\d.]+-flash/.test(n) && !/(image|tts|audio|live|thinking|embedding|8b)/.test(n));
  if (!L.length) throw new Error('مفيش موديل Gemini flash متاح للمفتاح ده');
  /* الثابت قبل التجريبي (preview/exp)، وبعدين الأحدث، والعادي قبل lite */
  L.sort((a, b) => (/(preview|exp)/.test(a) - /(preview|exp)/.test(b)) || (ver(b) - ver(a)) || (/lite/.test(a) - /lite/.test(b)) || (a.length - b.length));
  PropertiesService.getScriptProperties().setProperties({ gem_model: L[0], gem_models: JSON.stringify(L.slice(0, 6)) }); return L[0];
}
function gem_(parts, temp, again) {
  const P = PropertiesService.getScriptProperties(), fixed = P.getProperty('GEMINI_MODEL');
  const first = gemModel_(); let more = []; try { more = JSON.parse(P.getProperty('gem_models') || '[]'); } catch (e) {}
  if (!more.length && !fixed) { try { gemPick_(); more = JSON.parse(P.getProperty('gem_models') || '[]'); } catch (e) {} }
  /* الموديل الأساسي، ولو عليه ضغط (503/429/500) بنستنى ونعيد، وبعدين نجرّب الموديلات اللي بعده */
  const models = [first].concat(fixed ? [] : more.filter(m => m != first)).slice(0, 3);
  /* «تفكير» قليل = رد أسرع بكتير (الواجب مش محتاج تفكير طويل). لو الموديل مابيدعمهوش بنشيله ونعيد */
  let think = P.getProperty('gem_nothink') ? null : { thinkingLevel: 'low' };
  const bodyOf = () => JSON.stringify({ contents: [{ parts: parts }], generationConfig: Object.assign({ temperature: temp == null ? 0.4 : temp, responseMimeType: 'application/json' }, think ? { thinkingConfig: think } : {}) });
  let body = bodyOf();
  let last = '';
  for (let i = 0; i < models.length; i++) {
    for (let t = 0; t < 3; t++) {
      const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(GEM_()), { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: body });
      const code = r.getResponseCode(), txt = r.getContentText();
      if (code == 200) { const j = JSON.parse(txt); return JSON.parse(((j.candidates || [])[0].content.parts || []).map(p => p.text || '').join('')); }
      last = 'Gemini (' + models[i] + ') ' + code + ': ' + txt.slice(0, 200);
      /* الموديل اتقفل: نختار من جديد مرة واحدة */
      if ((code == 404 || code == 400 && /model/i.test(txt)) && !fixed && !again) { P.deleteProperty('gem_model'); gemPick_(); return gem_(parts, temp, 1); }
      if (code == 400 && think && /think/i.test(txt)) { think = null; P.setProperty('gem_nothink', '1'); body = bodyOf(); t--; continue; }
      if (code == 503 || code == 429 || code == 500) { Utilities.sleep([2000, 5000, 0][t]); continue; }
      throw new Error(last);
    }
  }
  throw new Error(last + ' — جوجل عليها ضغط دلوقتي، جرّب كمان شوية');
}
function hOk_(c, h) { const r = load_()[c]; return !!(r && r.h && h && r.h === String(h)); }
function cls_(c, d) { const id = PropertiesService.getScriptProperties().getProperty('gf_' + c); if (!id || !d) return null; const it = DriveApp.getFolderById(id).getFoldersByName(String(d)); return it.hasNext() ? it.next() : null; }
function fileIn_(f, re) { const it = f.getFiles(); while (it.hasNext()) { const x = it.next(); if (re.test(x.getName())) return x; } return null; }
function jget_(f, name) { const x = fileIn_(f, new RegExp('^' + name.replace('.', '\\.') + '$')); try { return x ? JSON.parse(x.getBlob().getDataAsString()) : null; } catch (e) { return null; } }
function jput_(f, name, o) { const x = fileIn_(f, new RegExp('^' + name.replace('.', '\\.') + '$')), t = JSON.stringify(o); if (x) x.setContent(t); else f.createFile(name, t, MimeType.PLAIN_TEXT); }
/* ▶ Run من المحرر: بيختار الموديل ويجرّبه — النتيجة في Execution log */
function testGemini() { PropertiesService.getScriptProperties().deleteProperty('gem_model'); const m = gemPick_(); Logger.log('الموديل: ' + m + '\n' + JSON.stringify(gem_([{ text: 'رجّع JSON: {"ok":true}' }], 0))); }
const nrm_ = s => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}.\-\/]+/gu, ' ').trim();
const pubHw_ = hw => ({ title: hw.title || '', qs: (hw.qs || []).map(q => ({ type: q.type, q: q.q, options: q.options || null })) });

/* الواجب بيتعمل في الخلفية (Gemini ممكن ياخد دقايق والمتصفح بيقطع الاتصال): hwgen بيحط الطلب في طابور ويرجع على طول،
   وتريجر hwJob_ بيعمله، والصفحة بتتابع من hwlist لحد ما المسودة تظهر */
function hwGen_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); if (!GEM_()) return out_({ ok: false, e: 'nokey' });
  const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const old = jget_(f, 'hw.json'); if (old && !b.re) return out_({ ok: true, hw: old });
  if (!fileIn_(f, /(السبورة\.pdf|التفريغ\.txt)$/)) return out_({ ok: false, e: 'empty' });
  const P = PropertiesService.getScriptProperties(), L = LockService.getScriptLock(); L.waitLock(15000);
  try { let q = []; try { q = JSON.parse(P.getProperty('hwq') || '[]'); } catch (x) {}
    if (!q.some(j => j.c == b.c && j.d == b.d)) q.push({ c: b.c, d: String(b.d), re: b.re ? 1 : 0 });
    P.setProperties({ hwq: JSON.stringify(q.slice(-30)), ['hws_' + b.c + '|' + b.d]: JSON.stringify({ s: 'run', t: Date.now() }) });
  } finally { L.releaseLock(); }
  hwKick_(); return out_({ ok: true, pending: 1 });
}
function hwKick_() { if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() == 'hwJob_')) ScriptApp.newTrigger('hwJob_').timeBased().after(1000).create(); }
function hwJob_() {
  const P = PropertiesService.getScriptProperties(), t0 = Date.now(), L = LockService.getScriptLock(); if (!L.tryLock(1000)) return;
  try {
    ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() == 'hwJob_') ScriptApp.deleteTrigger(t); });
    while (Date.now() - t0 < 240000) {
      let q = []; try { q = JSON.parse(P.getProperty('hwq') || '[]'); } catch (x) {} if (!q.length) break;
      const j = q.shift(); P.setProperty('hwq', JSON.stringify(q)); let r;
      try { r = hwMake_(j.c, j.d, j.re); } catch (x) { r = { ok: false, e: String(x && x.message || x) }; }
      if (r.ok) P.deleteProperty('hws_' + j.c + '|' + j.d); else P.setProperty('hws_' + j.c + '|' + j.d, JSON.stringify({ s: 'err', e: String(r.e).slice(0, 300), t: Date.now() }));
    }
    if (JSON.parse(P.getProperty('hwq') || '[]').length) ScriptApp.newTrigger('hwJob_').timeBased().after(1000).create();
  } finally { L.releaseLock(); }
}
function hwMake_(c, d, re) {
  const f = cls_(c, d); if (!f) return { ok: false, e: 'class' };
  const old = jget_(f, 'hw.json'); if (old && !re) return { ok: true, hw: old };
  const b = { c: c, d: d };
  const pdf = fileIn_(f, /السبورة\.pdf$/), tr = fileIn_(f, /التفريغ\.txt$/); if (!pdf && !tr) return ({ ok: false, e: 'empty' });
  const room = load_()[b.c] || {};
  const parts = [{ text: 'أنت مدرس شاطر. ده محتوى حصة «' + (room.n || '') + '» (السبورة PDF وتفريغ الكلام لو موجود). اكتب واجب منزلي على نفس الدرس بالظبط ونفس المستوى والأمثلة، وبنفس لغة المادة اللي على السبورة (لو إنجليزي يبقى بالإنجليزي، لو عربي يبقى بالعربي).\n' +
    'بالظبط 10 أسئلة متنوعة ومتدرجة من السهل للصعب: 4 اختيار من متعدد (4 اختيارات)، 2 صح وغلط، 2 أكمل، 2 سؤال مقالي/مسألة قصيرة.\n' +
    'رجّع JSON بس بالشكل ده: {"title":"عنوان قصير للواجب","questions":[{"type":"mcq|tf|fill|short","q":"نص السؤال","options":["..."] (للـ mcq بس),"answer":"الإجابة الصحيحة بالظبط (للـ mcq نص الاختيار الصح، وللـ tf «صح» أو «خطأ» أو True/False)","explain":"شرح سطر واحد للإجابة"}]}' }];
  if (pdf && pdf.getSize() < 18e6) parts.push({ inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdf.getBlob().getBytes()) } });
  if (tr) parts.push({ text: 'تفريغ كلام الحصة:\n' + tr.getBlob().getDataAsString().slice(0, 30000) });
  let o; try { o = gem_(parts); } catch (e) { return ({ ok: false, e: String(e.message || e) }); }
  const qs = (o.questions || []).filter(q => q && q.q).slice(0, 10).map(q => ({ type: /^(mcq|tf|fill|short)$/.test(q.type) ? q.type : 'short', q: String(q.q).slice(0, 600), options: Array.isArray(q.options) ? q.options.slice(0, 6).map(String) : null, answer: String(q.answer || '').slice(0, 600), explain: String(q.explain || '').slice(0, 400) }));
  if (!qs.length) return ({ ok: false, e: 'gen' });
  const hw = { st: 'draft', at: Date.now(), title: String(o.title || '').slice(0, 120), qs: qs }; jput_(f, 'hw.json', hw);
  return ({ ok: true, hw: hw });
}
function hwPub_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const h = b.hw || {}; const qs = (h.qs || []).filter(q => q && q.q).slice(0, 15).map(q => ({ type: /^(mcq|tf|fill|short)$/.test(q.type) ? q.type : 'short', q: String(q.q).slice(0, 600), options: Array.isArray(q.options) ? q.options.slice(0, 6).map(String) : null, answer: String(q.answer || '').slice(0, 600), explain: String(q.explain || '').slice(0, 400) }));
  if (!qs.length) return out_({ ok: false, e: 'empty' });
  const hw = { st: b.pub ? 'pub' : 'draft', at: Date.now(), title: String(h.title || '').slice(0, 120), qs: qs }; jput_(f, 'hw.json', hw);
  if (b.pub) { const t = '📝 ' + (hw.title || 'الواجب') + ' — الإجابات النموذجية\n\n' + qs.map((q, i) => (i + 1) + ') ' + q.q + (q.options ? '\n   [' + q.options.join(' / ') + ']' : '') + '\n   ✅ ' + q.answer + (q.explain ? '\n   💡 ' + q.explain : '')).join('\n\n');
    const x = fileIn_(f, /الإجابات_النموذجية\.txt$/); if (x) x.setContent('﻿' + t); else f.createFile(f.getName() + '_الإجابات_النموذجية.txt', '﻿' + t, MimeType.PLAIN_TEXT); }
  CacheService.getScriptCache().remove('lib_' + b.c);
  return out_({ ok: true, hw: hw });
}
function hwSub_(b) {
  const f = cls_(String(b.c || '').toLowerCase(), b.d); if (!f) return out_({ ok: false, e: 'class' });
  const hw = jget_(f, 'hw.json'); if (!hw || hw.st != 'pub') return out_({ ok: false, e: 'nohw' });
  const ans = Array.isArray(b.ans) ? b.ans.map(a => String(a == null ? '' : a).slice(0, 1500)) : [], res = [], ai = [];
  hw.qs.forEach((q, i) => { const a = ans[i] || '';
    if (!a.trim()) { res[i] = { s: 0, fb: 'مفيش إجابة' }; return; }
    if (q.type == 'mcq' || q.type == 'tf') { const ok = nrm_(a) == nrm_(q.answer) || (q.type == 'tf' && /^(صح|صحيح|true|t)$/.test(nrm_(a)) == /^(صح|صحيح|true|t)$/.test(nrm_(q.answer))); res[i] = { s: ok ? 1 : 0, fb: ok ? '✔' : 'الصح: ' + q.answer }; return; }
    if (nrm_(a) == nrm_(q.answer)) { res[i] = { s: 1, fb: '✔' }; return; }
    ai.push(i); });
  if (ai.length && GEM_()) { try {
    const o = gem_([{ text: 'صحّح إجابات الطالب دي مقارنةً بالإجابة النموذجية. اقبل الإجابة لو المعنى صح حتى لو الصياغة مختلفة أو فيها أخطاء إملائية بسيطة. لكل سؤال اديله درجة 0 أو 0.5 أو 1، وملاحظة قصيرة بالعربي بتشرح الغلط لو فيه.\nرجّع JSON: {"r":[{"i":رقم,"s":درجة,"fb":"ملاحظة"}]}\n\n' +
      ai.map(i => '#' + i + '\nالسؤال: ' + hw.qs[i].q + '\nالنموذجية: ' + hw.qs[i].answer + '\nالطالب: ' + ans[i]).join('\n\n') }], 0);
    (o.r || []).forEach(x => { if (ai.indexOf(+x.i) > -1) res[+x.i] = { s: Math.max(0, Math.min(1, +x.s || 0)), fb: String(x.fb || '').slice(0, 300) }; });
  } catch (e) {} }
  ai.forEach(i => { if (!res[i]) res[i] = { s: 0, fb: 'هيتصحح من المعلم', p: 1 }; });
  const score = res.reduce((a, x) => a + (x ? x.s : 0), 0), total = hw.qs.length;
  const L = LockService.getScriptLock(); L.waitLock(20000);
  try { const subs = jget_(f, 'hw_sub.json') || []; subs.push({ n: String(b.n || 'طالب').slice(0, 40), at: Date.now(), score: score, total: total, ans: ans, res: res }); jput_(f, 'hw_sub.json', subs.slice(-300)); } finally { L.releaseLock(); }
  return out_({ ok: true, score: score, total: total, res: res, key: hw.qs.map(q => ({ answer: q.answer, explain: q.explain })) });
}
function hwList_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const id = PropertiesService.getScriptProperties().getProperty('gf_' + b.c); if (!id) return out_({ ok: true, items: [], key: !!GEM_() });
  const out = [], it = DriveApp.getFolderById(id).getFolders();
  while (it.hasNext()) { const f = it.next(), hw = jget_(f, 'hw.json'), subs = jget_(f, 'hw_sub.json') || [], has = !!fileIn_(f, /(السبورة\.pdf|التفريغ\.txt)$/);
    let S = null; try { S = JSON.parse(PropertiesService.getScriptProperties().getProperty('hws_' + b.c + '|' + f.getName()) || 'null'); } catch (z) {}
    /* حالة الطابور: بيتعمل (لو من أقل من 10 دقايق) أو فشل وسببه */
    const run = S && S.s == 'run' && Date.now() - S.t < 600000, err = S && (S.s == 'err' || S.s == 'run' && !run) ? (S.e || 'الذكاء الاصطناعي اتأخر — جرّب تاني') : '';
    if (has || hw) out.push({ d: f.getName(), st: run ? 'run' : hw ? hw.st : err ? 'err' : '', e: err, hw: hw, subs: subs.map(s => ({ n: s.n, at: s.at, score: s.score, total: s.total })) }); }
  out.sort((a, b) => a.d < b.d ? 1 : -1); return out_({ ok: true, items: out.slice(0, 40), key: !!GEM_() });
}

/* ===== 📚 ربط الحصص القديمة بالمكتبة =====
   linkOld(): تجربة بس — بتكتب في الـ log هتعمل إيه من غير ما تغيّر حاجة.
   linkOldRun(): بتنفّذ فعلًا: (1) أي فولدر اسمه «… (الكود)» بيتربط بالمجموعة،
   (2) الفيديوهات والسبورات القديمة المتسابة لوحدها (اسمها «اسم المجموعة_التاريخ_الساعة») بتتنقل لفولدر مجموعتها وجواه فولدر بتاريخ الحصة.
   ممكن تشغّلها كذا مرة — اللي اتربط قبل كده مابيتكررش. */
function linkOld() { linkOld_(false); }
function linkOldRun() { linkOld_(true); }
function linkOld_(go) {
  const P = PropertiesService.getScriptProperties(), rooms = load_(), t0 = Date.now(), log = [];
  let S = {}; try { S = sheet_(); } catch (x) {}
  const known = c => !!(rooms[c] || S[c]), nt = s => norm_(s).replace(/\s+/g, ' ').toLowerCase();
  /* (1) فولدرات المجموعات «الاسم (الكود)» */
  const byTitle = {}, fit = DriveApp.searchFolders("title contains '(' and trashed = false");
  while (fit.hasNext()) {
    const f = fit.next(), m = /^(.*?)\s*\(([A-Za-z0-9]{4,6})\)\s*$/.exec(f.getName()); if (!m) continue;
    const c = m[2].toLowerCase(); if (!known(c)) continue;
    if (m[1]) byTitle[nt(m[1])] = c;
    const cur = P.getProperty('gf_' + c);
    if (!cur) { log.push('🔗 ' + f.getName() + ' ← المجموعة ' + c); if (go) P.setProperty('gf_' + c, f.getId()); }
    else if (cur != f.getId()) log.push('⚠️ فيه أكتر من فولدر للمجموعة ' + c + ': «' + f.getName() + '» (سبته زي ما هو)');
  }
  Object.keys(rooms).forEach(c => { const n = rooms[c] && rooms[c].n; if (n && n != 'حصة' && !byTitle[nt(n)]) byTitle[nt(n)] = c; });
  /* (2) الملفات القديمة المتسابة لوحدها */
  const it = DriveApp.searchFiles("trashed = false and (mimeType contains 'video/' or mimeType = 'application/pdf') and title contains '_20'");
  let moved = 0, skip = 0;
  while (it.hasNext() && Date.now() - t0 < 300000) {
    const x = it.next(), nm = x.getName(), m = /^(.+?)_(\d{4}-\d\d-\d\d_\d\d-\d\d)/.exec(nm); if (!m) continue;
    const c = byTitle[nt(m[1])]; if (!c) { skip++; continue; }
    const par = x.getParents(), p = par.hasNext() ? par.next() : null;
    if (p && p.getName() == m[2]) continue; // متنقّل قبل كده
    const gid = P.getProperty('gf_' + c);
    log.push('📦 ' + nm + ' ← ' + c + '/' + m[2]); moved++;
    if (!go) continue;
    let g = gid ? DriveApp.getFolderById(gid) : folder_(m[1] + ' (' + c.toUpperCase() + ')');
    if (!gid) P.setProperty('gf_' + c, g.getId());
    const s = g.getFoldersByName(m[2]), d = s.hasNext() ? s.next() : g.createFolder(m[2]);
    x.moveTo(d); if (/^video\//.test(x.getMimeType()) || /السبورة/.test(nm)) try { x.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  }
  Object.keys(rooms).concat(Object.keys(S)).forEach(c => CacheService.getScriptCache().remove('lib_' + c));
  Logger.log((go ? '✅ اتنفّذ' : '🔎 تجربة بس (مفيش حاجة اتغيّرت)') + ' — ملفات: ' + moved + ' · ملفات مالقيتلهاش مجموعة: ' + skip + (it.hasNext() ? ' · الوقت خلص، شغّلها تاني تكمّل' : '') + '\n' + log.slice(0, 300).join('\n'));
}

/* 📄 سبورة الحصة للمكتبة: بنبعت الـ PDF نفسه للموقع يعرضه بنفسه (معاينة Drive جوه الصفحة بتطلع سودا على الآيفون)
   بس لو الملف سبورة PDF جوه فولدر حصة تبع المجموعة دي */
function pdf_(b) {
  const c = String(b.c || '').toLowerCase(), gid = PropertiesService.getScriptProperties().getProperty('gf_' + c);
  if (!/^[a-z0-9]{4,6}$/.test(c) || !gid || !/^[A-Za-z0-9_-]{10,100}$/.test(String(b.id || ''))) return out_({ ok: false, e: 'bad' });
  let x; try { x = DriveApp.getFileById(b.id); } catch (e) { return out_({ ok: false, e: 'nofile' }); }
  if (!/السبورة/.test(x.getName()) || !/pdf/.test(x.getMimeType())) return out_({ ok: false, e: 'type' });
  let ok = false; const ps = x.getParents(); while (ps.hasNext() && !ok) { const g = ps.next().getParents(); while (g.hasNext()) if (g.next().getId() == gid) ok = true; }
  if (!ok) return out_({ ok: false, e: 'group' });
  if (x.getSize() > 35e6) return out_({ ok: false, e: 'big' });
  return out_({ ok: true, d: Utilities.base64Encode(x.getBlob().getBytes()) });
}
