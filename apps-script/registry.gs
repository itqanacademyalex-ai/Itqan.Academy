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
const DUR = 60;    // مدة الحصة بالدقايق (لو مفيش عمود «المدة» في الشيت)

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
    const s = S || r.s || [];
    const now = new Date(), d = Number(Utilities.formatDate(now, TZ, 'u')) % 7; // 0 = الأحد
    const hm = Utilities.formatDate(now, TZ, 'HH:mm'), n = min_(hm);
    if (!r.v && !s.length) return out_({ ok: true, known: false, now: hm, d: d });
    const allow = s.some(q => +q[0] === d && n >= min_(q[1]) - EARLY && n < min_(q[1]) + (+q[2] || DUR));
    return out_({ ok: true, known: true, v: r.v || '', allow: allow, s: s, now: hm, d: d, src: S ? 'sheet' : 'app' });
  }
  if (p.a === 'list') { try { return out_({ ok: true, rooms: sheet_() }); } catch (x) { return out_({ ok: false, e: String(x) }); } }
  return out_({ ok: false });
}

function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { return out_({ ok: false, e: 'json' }); }
  if (b.k !== KEY) return out_({ ok: false, e: 'key' });
  if (b.a === 'put') {
    const R = {};
    (b.rooms || []).slice(0, 300).forEach(r => {
      const c = String(r.c || '').toLowerCase();
      if (!/^[a-z0-9]{4,6}$/.test(c)) return;
      R[c] = { v: String(r.v || '').slice(0, 20), s: (r.s || []).filter(q => Array.isArray(q) && q[0] >= 0 && q[0] <= 6 && /^\d{1,2}:\d{2}$/.test(q[1])).slice(0, 30).map(q => [+q[0], q[1], +q[2] || DUR]) };
    });
    PropertiesService.getScriptProperties().setProperty('rooms', JSON.stringify(R));
    return out_({ ok: true, n: Object.keys(R).length });
  }
  return out_({ ok: false });
}

/* اضغط ▶ Run على الدالة دي من المحرر عشان تشوف الحصص اللي اتقرت من الشيت (في Execution log) */
function test() { CacheService.getScriptCache().remove('sch'); Logger.log(JSON.stringify(sheet_(), null, 1)); }
