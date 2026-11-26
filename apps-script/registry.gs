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
/* الجدول بيتحفظ على أجزاء (كل خانة في Script Properties أقصاها 9 كيلو — الجدول الكامل بقى أكبر من كده فكان التحديث بيترفض) */
function load_() { try { const P = PropertiesService.getScriptProperties(), n = +(P.getProperty('rooms_n') || 0); if (!n) return JSON.parse(P.getProperty('rooms') || '{}');
  let t = ''; for (let i = 0; i < n; i++) t += P.getProperty('rooms_' + i) || ''; return JSON.parse(t || '{}'); } catch (e) { return {}; } }
function save_(R) { const P = PropertiesService.getScriptProperties(), t = JSON.stringify(R), old = +(P.getProperty('rooms_n') || 0), o = {};
  let i = 0; for (let k = 0; k < t.length; k += 2500) o['rooms_' + (i++)] = t.slice(k, k + 2500); o.rooms_n = String(i); P.setProperties(o);
  for (let k = i; k < old; k++) P.deleteProperty('rooms_' + k); P.deleteProperty('rooms'); }
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
  /* قايمة المدير بـ GET كمان (احتياطي لو طلب POST اتقطع) */
  if (p.a === 'lvl') return doPost_({ postData: { contents: JSON.stringify({ a: 'lvl', h: String(p.h || '') }) } });
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
    const lv = +(PropertiesService.getScriptProperties().getProperty('lv_' + c) || 0);
    return out_({ ok: true, known: true, v: r.v || '', allow: allow, live: Date.now() - lv < 150000, s: s, now: hm, d: d, today: today, src: (r.s && r.s.length) ? 'app' : 'sheet' });
  }
  /* حصص معلم واحد (لـ «حصصي» عند المعلم): بالاسم، أو باسم معلم الغرفة c */
  if (p.a === 'tl') {
    const all = load_(); let n = String(p.n || '').trim(); const c = String(p.c || '').toLowerCase();
    if (!n && c && all[c]) n = all[c].t || '';
    /* كل حصص المعلم (حتى اللي لسه مالهاش مواعيد)، والاسم بيتقارن بعد توحيد الكتابة (أ/ا، ى/ي، ة/ه، المسافات، «أ/»…) عشان مايتوهش حصص بسبب حرف */
    const N = tnN_(n), R = {}; if (N) Object.keys(all).forEach(k => { const r = all[k]; if (tnN_(r.t) === N) R[k] = { t: r.t, n: r.n || '', v: r.v || '', s: r.s || [] }; });
    return out_({ ok: true, rooms: R, n: n });
  }
  /* غرف السكرتارية المتشفّرة (بكلمة سر السكرتارية) — للمزامنة بين أجهزة السكرتارية */
  if (p.a === 'fxget') {
    const P = PropertiesService.getScriptProperties(), n = +(P.getProperty('fxb_n') || 0); let d = '';
    for (let i = 0; i < n; i++) d += P.getProperty('fxb_' + i) || '';
    return out_({ ok: true, d: d, t: +(P.getProperty('fxb_t') || 0) });
  }
  /* مكتبة المجموعة: كل حصة (فولدر بالتاريخ) والملفات اللي فيها — الأحدث الأول */
  if (p.a === 'lib') {
    /* المكتبة بتتقري من Drive مباشرة كل مرة (من غير نسخة محفوظة): أي ملف يترفع يظهر، وأي ملف أو فولدر يتحذف يختفي على طول */
    const c = String(p.c || '').toLowerCase(); if (!/^[a-z0-9]{4,6}$/.test(c)) return out_({ ok: false });
    const PS = PropertiesService.getScriptProperties(), C = CacheService.getScriptCache(); let id = PS.getProperty('gf_' + c), g = null;
    try { if (id) { g = DriveApp.getFolderById(id); if (g.isTrashed()) g = null; } } catch (x) { g = null; }
    /* مفيش فولدر مربوط؟ ندوّر على فولدر باسم المجموعة جوه «تسجيلات أكاديمية إتقان» */
    if (!g) { try { const r = load_()[c], t = r && String(r.n || '').replace(/[\\:*?"<>|]/g, '_').trim().slice(0, 120), R = DriveApp.getFoldersByName(ROOT);
      if (t && R.hasNext()) { const s2 = R.next().getFoldersByName(t); while (s2.hasNext()) { const x = s2.next(); if (!x.isTrashed()) { g = x; PS.setProperty('gf_' + c, x.getId()); break; } } } } catch (x) {} }
    if (!g) return out_({ ok: true, items: [] });
    const out = []; try { const it = g.getFolders();
      while (it.hasNext()) { const f = it.next(); if (f.isTrashed()) continue; const files = [], fi = f.getFiles();
        while (fi.hasNext()) { const x = fi.next(); if (x.isTrashed()) continue; const mt = x.getMimeType(), nm = x.getName();
          if (/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) { const xid = x.getId();
            /* أي فيديو أو سبورة (حتى اللي اتحط على Drive بإيدك) يتفتح باللينك عشان الطالب يشغّله — مرة واحدة لكل ملف */
            if (!C.get('sh_' + xid)) { try { if (x.getSharingAccess() != DriveApp.Access.ANYONE_WITH_LINK) x.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); C.put('sh_' + xid, '1', 21600); } catch (e) {} }
            files.push({ n: nm, id: xid, m: mt, s: x.getSize() }); } }
        try { const mf = f.getFoldersByName(MATF); if (mf.hasNext()) { const mi = mf.next().getFiles(); while (mi.hasNext()) { const x = mi.next(); if (x.isTrashed()) continue; const xid = x.getId();
          if (!C.get('sh_' + xid)) { try { if (x.getSharingAccess() != DriveApp.Access.ANYONE_WITH_LINK) x.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); C.put('sh_' + xid, '1', 21600); } catch (e) {} }
          files.push({ n: x.getName(), id: xid, m: x.getMimeType(), s: x.getSize(), mat: 1 }); } } } catch (e) {}
        const hw = jget_(f, 'hw.json'), it2 = { d: f.getName(), files: files }; if (hw && hw.st == 'pub') it2.hw = pubHw_(hw); if (files.length || it2.hw) out.push(it2); }
    } catch (x) { return out_({ ok: false, e: String(x) }); }
    out.sort((a, b) => a.d < b.d ? 1 : -1);
    return out_({ ok: true, items: out });
  }
  /* أكواد حصص المعلم المتشفّرة — بالبصمة بس (اسمه + كوده) */
  if (p.a === 'tr') { const h = String(p.h || ''); if (!/^[a-f0-9]{64}$/.test(h)) return out_({ ok: false }); const x = PropertiesService.getScriptProperties().getProperty('tr_' + h); return out_(x ? { ok: true, p: x } : { ok: false }); }
  if (p.a === 'tb') { const h = String(p.h || ''); if (!/^[a-f0-9]{64}$/.test(h)) return out_({ ok: false }); const x = PropertiesService.getScriptProperties().getProperty('tb_' + h); return out_(x ? { ok: true, b: x } : { ok: false, e: 'notfound' }); }
  if (p.a === 'list') { try { return out_({ ok: true, rooms: sheet_() }); } catch (x) { return out_({ ok: false, e: String(x) }); } }
  return out_({ ok: false });
}

function doPost_(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { return out_({ ok: false, e: 'json' }); }
  /* رفع التسجيل والملفات (زي سكربت التسجيل: من غير المفتاح) */
  /* المكتبة كمان بـ POST — بعض المتصفحات/الشبكات طلب GET بتاعها مابيوصلش للسكربت */
  if (b.a === 'lib') return doGet_({ parameter: { a: 'lib', c: b.c } });
  /* القراءات كمان بـ POST (طلبات GET ساعات بتترفض من جوجل قبل ما توصل هنا) */
  if (/^(chk|tl|tb|tr|fxget)$/.test(String(b.a || ''))) { const q = {}; Object.keys(b).forEach(k => { if (typeof b[k] !== 'object') q[k] = String(b[k]); }); return doGet_({ parameter: q }); }
  /* 🟢 المعلم فاتح الحصة: جهازه بيبلّغ كل دقيقة (بكوده أو ببصمة مفتاح الغرفة) */
  if (b.a === 'live') { const c = String(b.c || '').toLowerCase(), r = load_()[c]; if (!r) return out_({ ok: false });
    if (!((r.h && b.h && r.h === String(b.h)) || (r.v && b.v && r.v === String(b.v)))) return out_({ ok: false, e: 'auth' });
    const P = PropertiesService.getScriptProperties(); if (b.off) P.deleteProperty('lv_' + c); else P.setProperty('lv_' + c, String(Date.now()));
    /* نسخة سريعة لقايمة المدير (من غير ما يقرا كل الإعدادات): الحصص المفتوحة واسمها */
    try { const C = CacheService.getScriptCache(); let m = {}; try { m = JSON.parse(C.get('lvx') || '{}'); } catch (x) {} if (b.off) delete m[c]; else m[c] = { at: Date.now(), n: r.n || '', t: r.t || '', k: (/^[A-Za-z0-9_-]{86,88}$/.test(String(b.k || '')) && r.v && String(b.k).slice(1, 15) === r.v) ? String(b.k) : '' };
      Object.keys(m).forEach(k => { if (Date.now() - m[k].at > 150000) delete m[k]; }); C.put('lvx', JSON.stringify(m), 900); } catch (x) {}
    return out_({ ok: true }); }
  /* 👔 المدير: الحصص المفتوحة دلوقتي (المعلم بلّغ إنه فاتح من أقل من دقيقتين ونص) — ببصمة كلمة سر المدير.
     أول مرة المدير يفتح القايمة بصمته بتتسجّل، وبعد كده لازم نفس البصمة (dirReset من المحرر بيمسحها لو اتغيّرت كلمة السر) */
  if (b.a === 'lvl') { const h = String(b.h || ''); if (!/^[a-f0-9]{64}$/.test(h)) return out_({ ok: false, e: 'auth' });
    const P = PropertiesService.getScriptProperties(), cur = P.getProperty('dir_h'); if (!cur) P.setProperty('dir_h', h); else if (cur !== h) return out_({ ok: false, e: 'auth' });
    const now = Date.now(); let L = [], X = null; try { X = JSON.parse(CacheService.getScriptCache().get('lvx') || 'null'); } catch (x) {}
    if (X) Object.keys(X).forEach(c => { if (now - X[c].at < 150000) L.push({ c: c, n: X[c].n, t: X[c].t, at: X[c].at, k: X[c].k || '' }); });
    else { const all = load_(), A = P.getProperties(); Object.keys(A).filter(k => k.indexOf('lv_') === 0).forEach(k => { const c = k.slice(3), t = +A[k] || 0, r = all[c]; if (r && now - t < 150000) L.push({ c: c, n: r.n || '', t: r.t || '', at: t }); }); }
    L.sort((a, b2) => (a.t + a.n).localeCompare(b2.t + b2.n));
    /* all: كمان أسماء كل الغرف — جهاز المشرف بيحفظها ويسأل الغرف مباشرة (أسرع بكتير من السجل) */
    let rooms = null; if (b.all) { rooms = {}; try { const A2 = load_(); Object.keys(A2).forEach(c => { rooms[c] = { n: A2[c].n || '', t: A2[c].t || '' }; }); } catch (x) {} }
    return out_(rooms ? { ok: true, live: L, rooms: rooms } : { ok: true, live: L }); }
  if (b.a === 'pdf') return pdf_(b);
  if (b.a === 'hwgen') return hwGen_(b);
  if (b.a === 'hwpub') return hwPub_(b);
  if (b.a === 'hwsub') return hwSub_(b);
  if (b.a === 'hwmy') return hwMy_(b);
  if (b.a === 'hwsubs') return hwSubs_(b);
  if (b.a === 'hwgrade') return hwGrade_(b);
  if (b.a === 'hwlist') return hwList_(b);
  /* 📎 ملفات الحصة: المعلم بيرفع أي ملف (PDF، صور، HTML…) والطلاب بيشوفوه في تاب «الملفات» */
  if (b.a === 'mstart') return matStart_(b);
  if (b.a === 'mlist') return matList_(b);
  if (b.a === 'mdel') return matDel_(b);
  if (b.a === 'mraw') return matRaw_(b);
  /* حالة واجب حصة واحدة (خفيفة) — الصفحة بتسأل عليها وهي مستنية المسودة، بدل ما تقرا كل فولدرات المجموعة كل كام ثانية */
  if (b.a === 'hwst') { if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); let S = null; try { S = JSON.parse(PropertiesService.getScriptProperties().getProperty('hws_' + b.c + '|' + b.d) || 'null'); } catch (x) {}
    const f = cls_(b.c, b.d), hw = f ? jget_(f, 'hw.json') : null, run = S && S.s == 'run' && Date.now() - S.t < 600000;
    return out_({ ok: true, st: run ? 'run' : hw ? hw.st : S && S.s == 'err' ? 'err' : '', e: S && S.e || '', hw: hw }); }
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
    /* 🧩 دمج مش استبدال: زمان أي جهاز سكرتارية بيرفع قايمته كانت بتمسح أي غرفة مش عنده (جهاز تاني أو نسخة قديمة) ← الحصص كانت بتختفي من لينكات المعلمين.
       دلوقتي الغرف اللي اترفعت بتتحدّث، واللي مش موجودة بتفضل زي ما هي، وبيتمسح بس اللي في قايمة الحذف (del) */
    const R = load_(), DEL = {}; (Array.isArray(b.del) ? b.del : []).slice(0, 500).forEach(c => { DEL[String(c || '').toLowerCase()] = 1; });
    Object.keys(DEL).forEach(c => { delete R[c]; });
    (b.rooms || []).slice(0, 300).forEach(r => {
      const c = String(r.c || '').toLowerCase();
      if (!/^[a-z0-9]{4,6}$/.test(c)) return;
      R[c] = { v: String(r.v || '').slice(0, 20), h: /^[a-f0-9]{64}$/.test(r.h || '') ? r.h : '', t: String(r.t || '').slice(0, 40), n: String(r.n || '').slice(0, 60), s: (r.s || []).filter(q => Array.isArray(q) && q[0] >= 0 && q[0] <= 6 && /^\d{1,2}:\d{2}$/.test(q[1])).slice(0, 30).map(q => /^\d{4}-\d{2}-\d{2}$/.test(q[3] || '') ? [+q[0], q[1], +q[2] || DUR, q[3]] : [+q[0], q[1], +q[2] || DUR]) };
    });
    Object.keys(DEL).forEach(c => { delete R[c]; });
    /* الحصص الاستثنائية اللي ميعادها عدّى (كل مواعيدها بتاريخ قديم) بتتشال لوحدها */
    const old2 = Utilities.formatDate(new Date(Date.now() - 2 * 864e5), TZ, 'yyyy-MM-dd');
    Object.keys(R).forEach(c => { const s2 = R[c].s || []; if (s2.length && s2.every(q => q[3] && q[3] < old2)) delete R[c]; });
    save_(R);
    /* لينك المعلم الثابت: أكواد حصص كل معلم (متشفّرة بكوده) — بتتحفظ باسم بصمة (اسمه + كوده)، فمحدش ياخدها من غير الكود */
    if (Array.isArray(b.teachers)) { const P = PropertiesService.getScriptProperties(), keep = {}, o = {};
      b.teachers.slice(0, 200).forEach(t => { const h = String(t && t.h || ''), x = String(t && t.b || ''); if (/^[a-f0-9]{64}$/.test(h) && /^[A-Za-z0-9_-]{40,8000}$/.test(x)) { o['tb_' + h] = x; keep['tb_' + h] = 1; } });
      let old = []; try { old = JSON.parse(P.getProperty('tb_keys') || '[]'); } catch (e) {}
      /* دمج: المفاتيح القديمة بتفضل، وبيتمسح بس اللي الجهاز طلب يمسحه (كود معلم اتجدّد) */
      const drop = {}; (Array.isArray(b.tbdrop) ? b.tbdrop : []).forEach(h => { if (/^[a-f0-9]{64}$/.test(String(h))) drop['tb_' + h] = 1; });
      const all = {}; old.concat(Object.keys(keep)).forEach(k => { if (!drop[k]) all[k] = 1; });
      o.tb_keys = JSON.stringify(Object.keys(all)); P.setProperties(o); Object.keys(drop).forEach(k => { if (!keep[k]) P.deleteProperty(k); }); }
    /* كود المعلم الموحّد ← كود كل غرفة من غرفه (بالبصمة بتاعة «الغرفة + الكود الموحّد») */
    if (Array.isArray(b.tpins)) { const P = PropertiesService.getScriptProperties(), keep = {}, o = {};
      b.tpins.slice(0, 400).forEach(t => { const h = String(t && t.h || ''), x = String(t && t.p || ''); if (/^[a-f0-9]{64}$/.test(h) && /^\d{4,6}$/.test(x)) { o['tr_' + h] = x; keep['tr_' + h] = 1; } });
      let old = []; try { old = JSON.parse(P.getProperty('tr_keys') || '[]'); } catch (e) {}
      const drop = {}; (Array.isArray(b.trdrop) ? b.trdrop : []).forEach(h => { if (/^[a-f0-9]{64}$/.test(String(h))) drop['tr_' + h] = 1; });
      const all = {}; old.concat(Object.keys(keep)).forEach(k => { if (!drop[k]) all[k] = 1; });
      o.tr_keys = JSON.stringify(Object.keys(all)); P.setProperties(o); Object.keys(drop).forEach(k => { if (!keep[k]) P.deleteProperty(k); }); }
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
  const s = Utilities.getUuid(); CacheService.getScriptCache().put('up_' + s, loc, 21600); PropertiesService.getScriptProperties().setProperty('up_' + s, loc); // بيفضل محفوظ لو المعلم قفل والرفع كمّل بعد ساعات
  if (/^[a-z0-9]{4,6}$/.test(c)) { CacheService.getScriptCache().put('upc_' + s, c, 21600); PropertiesService.getScriptProperties().setProperty('upc_' + s, c); CacheService.getScriptCache().remove('lb2_' + c); }
  return out_({ ok: true, s: s });
}
/* الملف خلص رفع: يتفتح باللينك (الفيديو والسبورة بس — الملخص والتفريغ خاصين بالإدارة) + تتمسح نسخة المكتبة القديمة عشان يظهر للطلاب على طول */
function upDone_(s, id) {
  const C = CacheService.getScriptCache(), P = PropertiesService.getScriptProperties(), rc = C.get('upc_' + s) || P.getProperty('upc_' + s);
  C.remove('up_' + s); P.deleteProperty('up_' + s); P.deleteProperty('upc_' + s); C.remove('upc_' + s);
  if (id) { try { const fl = DriveApp.getFileById(id), mt = fl.getMimeType(), nm = fl.getName(); if (/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) fl.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (x) {} }
  /* نفس الحصة اتفتحت تاني ورفعت سبورة جديدة (فيها كل الصفحات): النسخة القديمة بنفس الاسم تتشال، فيفضل ملف سبورة واحد */
  if (id) { try { const fl = DriveApp.getFileById(id), nm = fl.getName(); if (/(السبورة|مصدر-الواجب)\.pdf$/.test(nm)) { const ps = fl.getParents(); if (ps.hasNext()) { const it = ps.next().getFilesByName(nm); while (it.hasNext()) { const x = it.next(); if (x.getId() !== id && !x.isTrashed()) x.setTrashed(true); } } } } catch (x) {} }
  if (rc) C.remove('lb2_' + rc);
  if (rc && id) hwAuto_(rc, id);
}
function upLoc_(s) { return CacheService.getScriptCache().get('up_' + s) || PropertiesService.getScriptProperties().getProperty('up_' + s); }
function upChunk_(b) {
  const loc = upLoc_(b.s); if (!loc) return out_({ ok: false, e: 'session' });
  const bytes = b.d ? Utilities.base64Decode(b.d) : null;
  const range = bytes && bytes.length ? 'bytes ' + b.st + '-' + b.en + '/' + b.tot : 'bytes */' + b.tot;
  const r = UrlFetchApp.fetch(loc, { method: 'put', contentType: String(b.m || 'application/octet-stream').split(';')[0], payload: bytes || '', headers: { 'Content-Range': range }, muteHttpExceptions: true });
  const c = r.getResponseCode();
  if (c == 308) return out_({ ok: true, done: 0 });
  if (c == 200 || c == 201) { let id = ''; try { id = JSON.parse(r.getContentText()).id; } catch (x) {} upDone_(b.s, id); return out_({ ok: true, done: 1, id: id }); }
  return out_({ ok: false, e: 'chunk ' + c + ' ' + r.getContentText().slice(0, 80) });
}
function upStatus_(b) {
  const loc = upLoc_(b.s); if (!loc) return out_({ ok: false, e: 'session' });
  const r = UrlFetchApp.fetch(loc, { method: 'put', payload: '', headers: { 'Content-Range': 'bytes */*' }, muteHttpExceptions: true });
  /* لو الملف خلص رفع فعلًا (والرد الأخير ضاع في النت) Drive بيرد 200 — نقول للموقع إنه خلص بدل ما يفضل يعيد */
  const code = r.getResponseCode(); if (code == 200 || code == 201) { let id = ''; try { id = JSON.parse(r.getContentText()).id; } catch (x) {} upDone_(b.s, id); return out_({ ok: true, done: 1, id: id }); }
  const g = (r.getHeaders()['Range'] || r.getHeaders()['range'] || ''), m = /bytes=0-(\d+)/.exec(g);
  return out_({ ok: true, r: m ? +m[1] + 1 : 0, code: code });
}
/* ▶ Run مرة واحدة بعد التحديث: بتدّي السكربت صلاحية Drive وبتعمل الفولدر الرئيسي */
function authDrive() { folder_(''); UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=user', { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } }); Logger.log('تمام — فولدر «' + ROOT + '» جاهز'); }

/* اختبار المكتبة من المحرر: شغّلها وشوف النتيجة في Execution log */
/* تشغيل مرة واحدة (اختياري): يفتح باللينك كل فيديوهات وسبورات الحصص القديمة اللي اترفعت قبل كده، ويمسح نسخ المكتبة */
function shareAll() { const P = PropertiesService.getScriptProperties().getProperties(); let n = 0;
  Object.keys(P).filter(k => k.indexOf('gf_') === 0).forEach(k => { try { CacheService.getScriptCache().remove('lb2_' + k.slice(3)); const it = DriveApp.getFolderById(P[k]).getFolders();
    while (it.hasNext()) { const fi = it.next().getFiles(); while (fi.hasNext()) { const x = fi.next(), mt = x.getMimeType(), nm = x.getName();
      if ((/^video\//.test(mt) || (/السبورة/.test(nm) && /pdf/.test(mt))) && x.getSharingAccess() != DriveApp.Access.ANYONE_WITH_LINK) { x.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); n++; } } } } catch (e) {} });
  Logger.log('اتفتح ' + n + ' ملف'); }
function testLib() { Logger.log(doGet({ parameter: { a: 'lib', c: 'hhe8' } }).getContent()); }

/* ===== 📝 الواجب التلقائي من السبورة (Gemini) — المفتاح في Script Properties باسم GEMINI_KEY، مابيوصلش لأي جهاز =====
   hwgen: مسودة 10 أسئلة من سبورة الحصة وتفريغها ← المعلم يراجع ← hwpub: ينشر (والإجابات النموذجية ملف للمعلم بس)
   hwsub: الطالب يحل ← تصحيح تلقائي (الاختيارات بالمقارنة، والكتابي بالذكاء الاصطناعي) ← hwres: النتايج للمعلم */
/* الموديل: GEMINI_MODEL في Script Properties لو حابب تحدده بنفسك، وإلا السكربت بيختار لوحده أحدث موديل «flash» متاح لمفتاحك
   (جوجل بتقفل الموديلات القديمة للحسابات الجديدة — زي gemini-2.5-flash — فلو الموديل رجّع 404 بنختار غيره ونحفظه) */
const GEM_ = () => PropertiesService.getScriptProperties().getProperty('GEMINI_KEY') || '';
/* 🤖 Claude (Anthropic): لو مفتاحه متسجّل في Script properties باسم CLAUDE_KEY، الواجبات والتصحيح بيتعملوا بيه بدل Gemini */
const CLA_ = () => { const P = PropertiesService.getScriptProperties(); return P.getProperty('CLAUDE_KEY') || P.getProperty('ANTHROPIC_API_KEY') || ''; };
const AIK_ = () => !!(CLA_() || GEM_());
/* أجزاء الطلب (بصيغة Gemini: نص + PDF) ← محتوى Claude: الملفات الأول وبعدين النص */
function claBody_(parts) {
  const docs = [], txt = [];
  parts.forEach(p => { if (p.inline_data) docs.push({ type: 'document', source: { type: 'base64', media_type: p.inline_data.mime_type, data: p.inline_data.data } }); else if (p.text) txt.push({ type: 'text', text: p.text }); });
  txt.push({ type: 'text', text: 'رجّع JSON صالح بس، من غير أي كلام قبله أو بعده ومن غير ```.' });
  const P = PropertiesService.getScriptProperties(), m = P.getProperty('CLAUDE_MODEL') || 'claude-opus-5-5', o = { model: m, max_tokens: 16000,
    output_config: { effort: P.getProperty('CLAUDE_EFFORT') || 'low' }, messages: [{ role: 'user', content: docs.concat(txt) }] };
  /* لو الطلب اترفض لأسباب أمان، Anthropic بتعيده على موديل تاني لوحدها (للموديلات اللي بتدعم ده) */
  if (/^claude-(opus-5-5|fable-5-[12]|sonnet-5-5)$/.test(m)) o.fallbacks = 'default';
  return JSON.stringify(o);
}
function claReq_(parts) { return { url: 'https://api.anthropic.com/v1/messages', method: 'post', contentType: 'application/json', muteHttpExceptions: true,
  headers: { 'x-api-key': CLA_(), 'anthropic-version': '2026-10-21', 'anthropic-beta': 'server-side-fallback-2026-07-01' }, payload: claBody_(parts) }; }
function claTxt_(txt) {
  const j = JSON.parse(txt); if (j.stop_reason === 'refusal') throw new Error('Claude رفض الطلب');
  let t = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, ''); const a = t.indexOf('{'), z = t.lastIndexOf('}'); if (a >= 0 && z > a) t = t.slice(a, z + 1);
  return JSON.parse(t);
}
function cla_(parts) {
  let last = '';
  for (let t = 0; t < 4; t++) {
    const q = claReq_(parts), r = UrlFetchApp.fetch(q.url, q), code = r.getResponseCode(), txt = r.getContentText();
    if (code == 200) return claTxt_(txt);
    last = 'Claude ' + code + ': ' + txt.slice(0, 200);
    if (code == 429 || code == 529 || code >= 500) { Utilities.sleep([3000, 8000, 15000, 0][t]); continue; }
    throw new Error(last);
  }
  throw new Error(last + ' — عليه ضغط دلوقتي، جرّب كمان شوية');
}
function claAll_(list) {
  let rs = []; try { rs = UrlFetchApp.fetchAll(list.map(claReq_)); } catch (e) {}
  return list.map((parts, i) => { const r = rs[i]; if (r && r.getResponseCode() == 200) { try { return claTxt_(r.getContentText()); } catch (e) {} } return cla_(parts); });
}
/* الذكاء الاصطناعي المستخدم: Claude لو مفتاحه موجود، وإلا Gemini */
function ai_(parts, temp) { return CLA_() ? cla_(parts) : gem_(parts, temp); }
function aiAll_(list, temp) { return CLA_() ? claAll_(list) : gemAll_(list, temp); }
/* ▶ Run من المحرر: تجربة مفتاح Claude — النتيجة في Execution log */
function testClaude() { Logger.log(JSON.stringify(cla_([{ text: 'رجّع JSON: {"ok":true}' }]))); }
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
/* «تفكير» أقل = رد أسرع بكتير: Gemini 3 بـ thinkingLevel منخفض، و2.5 بميزانية تفكير صفر (من غيرها بيفكّر لوحده دقايق) */
function gemThink_(m) { if (PropertiesService.getScriptProperties().getProperty('gem_nothink_' + m)) return null; const v = +((/gemini-(\d+(?:\.\d+)?)/.exec(m) || [])[1] || 0); return v >= 3 ? { thinkingLevel: 'low' } : v >= 2.5 ? { thinkingBudget: 0 } : null; }
function gemBody_(parts, temp, think) { return JSON.stringify({ contents: [{ parts: parts }], generationConfig: Object.assign({ temperature: temp == null ? 0.4 : temp, responseMimeType: 'application/json' }, think ? { thinkingConfig: think } : {}) }); }
function gemTxt_(txt) { const j = JSON.parse(txt); return JSON.parse(((j.candidates || [])[0].content.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')); }
/* كذا طلب في نفس الوقت (الواجب بيتقسم نصين بيتعملوا مع بعض = نص الوقت). اللي يفشل بيتعاد لوحده بالطريقة العادية */
function gemAll_(list, temp) {
  const m = gemModel_(), th = gemThink_(m), K = encodeURIComponent(GEM_());
  let rs = []; try { rs = UrlFetchApp.fetchAll(list.map(parts => ({ url: 'https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent?key=' + K, method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: gemBody_(parts, temp, th) }))); } catch (e) {}
  return list.map((parts, i) => { const r = rs[i]; if (r && r.getResponseCode() == 200) { try { return gemTxt_(r.getContentText()); } catch (e) {} } return gem_(parts, temp); });
}
function gem_(parts, temp, again) {
  const P = PropertiesService.getScriptProperties(), fixed = P.getProperty('GEMINI_MODEL');
  const first = gemModel_(); let more = []; try { more = JSON.parse(P.getProperty('gem_models') || '[]'); } catch (e) {}
  if (!more.length && !fixed) { try { gemPick_(); more = JSON.parse(P.getProperty('gem_models') || '[]'); } catch (e) {} }
  /* الموديل الأساسي، ولو عليه ضغط (503/429/500) بنستنى ونعيد، وبعدين نجرّب الموديلات اللي بعده */
  const models = [first].concat(fixed ? [] : more.filter(m => m != first)).slice(0, 3);
  /* «تفكير» قليل = رد أسرع بكتير (الواجب مش محتاج تفكير طويل). لو الموديل مابيدعمهوش بنشيله ونعيد */
  let last = '';
  for (let i = 0; i < models.length; i++) {
    let think = gemThink_(models[i]), body = gemBody_(parts, temp, think);
    for (let t = 0; t < 3; t++) {
      const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + models[i] + ':generateContent?key=' + encodeURIComponent(GEM_()), { method: 'post', contentType: 'application/json', muteHttpExceptions: true, payload: body });
      const code = r.getResponseCode(), txt = r.getContentText();
      if (code == 200) return gemTxt_(txt);
      last = 'Gemini (' + models[i] + ') ' + code + ': ' + txt.slice(0, 200);
      /* الموديل اتقفل: نختار من جديد مرة واحدة */
      if ((code == 404 || code == 400 && /model/i.test(txt)) && !fixed && !again) { P.deleteProperty('gem_model'); gemPick_(); return gem_(parts, temp, 1); }
      if (code == 400 && think && /think/i.test(txt)) { think = null; P.setProperty('gem_nothink_' + models[i], '1'); body = gemBody_(parts, temp, null); t--; continue; }
      if (code == 503 || code == 429 || code == 500) { Utilities.sleep([2000, 5000, 0][t]); continue; }
      throw new Error(last);
    }
  }
  throw new Error(last + ' — جوجل عليها ضغط دلوقتي، جرّب كمان شوية');
}
function tnN_(x) { return String(x || '').replace(/[\u064B-\u065F\u0640]/g, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/^\s*(ا|م|د|الاستاذ|الاستاذه|استاذ|استاذه|مس|مستر|Mr|Ms|Mrs|Miss)(\s*[\/.]\s*|\s+)/i, '').replace(/[\/.]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }
/* ▶ Run لو كلمة سر المدير اتغيّرت: بيمسح بصمتها، وأول دخول للمدير بعد كده بيسجّل الجديدة */
function dirReset() { PropertiesService.getScriptProperties().deleteProperty('dir_h'); Logger.log('تمام'); }
/* صلاحية المعلم على حصة (الواجبات، النتايج، الملفات): بصمة كود المعلم — أو بصمة كلمة سر Academic Supervisor (نفس صلاحية المعلم على كل الحصص) */
function hOk_(c, h) { if (!h) return false; const r = load_()[c]; if (!r) return false;
  const d = PropertiesService.getScriptProperties().getProperty('dir_h'); if (d && String(h) === d) return true;
  return !!(r.h && r.h === String(h)); }
function cls_(c, d) { const id = PropertiesService.getScriptProperties().getProperty('gf_' + c); if (!id || !d) return null; const it = DriveApp.getFolderById(id).getFoldersByName(String(d)); return it.hasNext() ? it.next() : null; }
function fileIn_(f, re) { const it = f.getFiles(); while (it.hasNext()) { const x = it.next(); if (re.test(x.getName())) return x; } return null; }
function jget_(f, name) { const x = fileIn_(f, new RegExp('^' + name.replace('.', '\\.') + '$')); try { return x ? JSON.parse(x.getBlob().getDataAsString()) : null; } catch (e) { return null; } }
function jput_(f, name, o) { const x = fileIn_(f, new RegExp('^' + name.replace('.', '\\.') + '$')), t = JSON.stringify(o); if (x) x.setContent(t); else f.createFile(name, t, MimeType.PLAIN_TEXT); }
/* ▶ Run من المحرر: بيختار الموديل ويجرّبه — النتيجة في Execution log */
function testGemini() { PropertiesService.getScriptProperties().deleteProperty('gem_model'); const m = gemPick_(); Logger.log('الموديل: ' + m + '\n' + JSON.stringify(gem_([{ text: 'رجّع JSON: {"ok":true}' }], 0))); }
const nrm_ = s => String(s == null ? '' : s).toLowerCase().replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[^\p{L}\p{N}.\-\/]+/gu, ' ').trim();
const pubHw_ = hw => ({ title: hw.title || '', qs: (hw.qs || []).map(q => ({ type: q.type, q: q.q, options: q.options || null, fig: q.fig || '' })) });
/* رسمة السؤال (هندسة/رسم بياني): SVG بس، من غير سكربت ولا روابط خارجية — والموقع بيعرضها كصورة فمفيش أي كود بيشتغل */
/* رسمة السؤال بوصف قصير (بدل ما الذكاء الاصطناعي يكتب SVG طويل = أبطأ بكتير): قايمة عناصر بإحداثيات رياضية (y لفوق)،
   والسكربت بيرسمها SVG نضيف بمقاس ثابت. العناصر:
   ["poly",[[x,y],...]] مضلع · ["line",[x,y],[x,y],1?] خط (1 = متقطع) · ["circle",[x,y],r] · ["arc",[x,y],r,من,لحد] قوس زاوية بالدرجات
   ["right",[رأس],[نقطة على ضلع],[نقطة على ضلع]] علامة زاوية قايمة · ["point",[x,y],"A"] · ["text",[x,y],"8 cm"]
   ["axes",xmin,xmax,ymin,ymax] محاور بأرقام · ["fn","x^2-1",xmin,xmax] منحنى دالة · ["numline",min,max,[علامات]] خط أعداد · ["bars",["أ","ب"],[3,5]] أعمدة */
function figSvg_(F) {
  try { if (!Array.isArray(F) || !F.length) return ''; F = F.filter(e => Array.isArray(e) && typeof e[0] == 'string').slice(0, 40);
    const N = v => (typeof v == 'number' && isFinite(v)) ? v : (isFinite(+v) ? +v : 0), P = a => Array.isArray(a) ? [N(a[0]), N(a[1])] : [0, 0];
    const esc = t => String(t == null ? '' : t).slice(0, 24).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const fnOf = ex => { const e = String(ex || '').toLowerCase().replace(/\s+/g, ''); if (!e || e.length > 60 || !/^([0-9x+\-*/^().]|sin|cos|tan|sqrt|abs|pi)+$/.test(e)) return null;
      try { const f = new Function('x', 'with(Math){return ' + e.replace(/\^/g, '**').replace(/(\d)(x|\()/g, '$1*$2').replace(/\)(x|\d|\()/g, ')*$1').replace(/pi/g, 'PI') + '}'); f(1); return f; } catch (x) { return null; } };
    /* حدود الرسمة */
    let X0 = Infinity, X1 = -Infinity, Y0 = Infinity, Y1 = -Infinity; const add = (x, y) => { X0 = Math.min(X0, x); X1 = Math.max(X1, x); Y0 = Math.min(Y0, y); Y1 = Math.max(Y1, y); };
    F.forEach(e => { const k = e[0];
      if (k == 'poly') (e[1] || []).forEach(p => add(...P(p))); else if (k == 'line') { add(...P(e[1])); add(...P(e[2])); }
      else if (k == 'circle' || k == 'arc') { const c = P(e[1]), r = Math.abs(N(e[2])); add(c[0] - r, c[1] - r); add(c[0] + r, c[1] + r); }
      else if (k == 'point' || k == 'text' || k == 'right') add(...P(e[1])); else if (k == 'axes') { add(N(e[1]), N(e[3])); add(N(e[2]), N(e[4])); }
      else if (k == 'fn') { const f = fnOf(e[1]); if (f) for (let i = 0; i <= 40; i++) { const x = N(e[2]) + (N(e[3]) - N(e[2])) * i / 40, y = f(x); if (isFinite(y) && Math.abs(y) < 1e4) add(x, y); } } });
    const one = F.find(e => e[0] == 'numline' || e[0] == 'bars');
    const W = 320, H = one ? 140 : 240, pad = 30; let svg = '';
    if (one && one[0] == 'numline') { const a = N(one[1]), b = N(one[2]) > a ? N(one[2]) : a + 10, sx = v => pad + (v - a) * (W - 2 * pad) / (b - a), st = Math.max(1, Math.round((b - a) / 10));
      svg += '<line x1="' + (pad - 10) + '" y1="70" x2="' + (W - pad + 10) + '" y2="70" stroke="#000" stroke-width="2.5"/>';
      for (let v = a; v <= b + 1e-9; v += st) svg += '<line x1="' + sx(v) + '" y1="62" x2="' + sx(v) + '" y2="78" stroke="#000" stroke-width="2"/><text x="' + sx(v) + '" y="98" font-size="14" text-anchor="middle">' + +v.toFixed(2) + '</text>';
      (one[3] || []).slice(0, 8).forEach(m => { const v = Array.isArray(m) ? N(m[0]) : N(m), l = Array.isArray(m) ? esc(m[1]) : ''; svg += '<circle cx="' + sx(v) + '" cy="70" r="6" fill="#d33"/>' + (l ? '<text x="' + sx(v) + '" y="50" font-size="15" text-anchor="middle" font-weight="bold">' + l + '</text>' : ''); });
    } else if (one) { const L = (one[1] || []).slice(0, 8), V = (one[2] || []).slice(0, 8).map(N), mx = Math.max(1, ...V), bw = (W - 2 * pad) / Math.max(1, L.length);
      svg += '<line x1="' + pad + '" y1="' + (H - 28) + '" x2="' + (W - pad) + '" y2="' + (H - 28) + '" stroke="#000" stroke-width="2"/>';
      L.forEach((l, i) => { const h = (V[i] || 0) / mx * (H - 60), x = pad + i * bw + bw * .2; svg += '<rect x="' + x + '" y="' + (H - 28 - h) + '" width="' + bw * .6 + '" height="' + h + '" fill="#9ec5fe" stroke="#000" stroke-width="1.5"/><text x="' + (x + bw * .3) + '" y="' + (H - 10) + '" font-size="13" text-anchor="middle">' + esc(l) + '</text><text x="' + (x + bw * .3) + '" y="' + (H - 33 - h) + '" font-size="13" text-anchor="middle">' + (V[i] || 0) + '</text>'; });
    } else {
      if (!isFinite(X0)) return ''; if (X1 - X0 < 1e-6) { X0 -= 1; X1 += 1; } if (Y1 - Y0 < 1e-6) { Y0 -= 1; Y1 += 1; }
      const sc = Math.min((W - 2 * pad) / (X1 - X0), (H - 2 * pad) / (Y1 - Y0)), ox = (W - (X1 - X0) * sc) / 2, oy = (H - (Y1 - Y0) * sc) / 2;
      const sx = x => +(ox + (x - X0) * sc).toFixed(1), sy = y => +(H - oy - (y - Y0) * sc).toFixed(1), S = 'stroke="#000" stroke-width="2.5" fill="none"';
      F.forEach(e => { const k = e[0];
        if (k == 'axes') { const a = N(e[1]), b = N(e[2]), c = N(e[3]), d = N(e[4]), st = Math.max(1, Math.round(Math.max(b - a, d - c) / 10));
          for (let v = Math.ceil(a); v <= b; v += st) svg += '<line x1="' + sx(v) + '" y1="' + sy(c) + '" x2="' + sx(v) + '" y2="' + sy(d) + '" stroke="#e5e7eb"/>' + (v ? '<text x="' + sx(v) + '" y="' + (sy(Math.max(c, Math.min(0, d))) + 14) + '" font-size="11" text-anchor="middle">' + v + '</text>' : '');
          for (let v = Math.ceil(c); v <= d; v += st) svg += '<line x1="' + sx(a) + '" y1="' + sy(v) + '" x2="' + sx(b) + '" y2="' + sy(v) + '" stroke="#e5e7eb"/>' + (v ? '<text x="' + (sx(Math.max(a, Math.min(0, b))) - 5) + '" y="' + (sy(v) + 4) + '" font-size="11" text-anchor="end">' + v + '</text>' : '');
          const y0 = Math.max(c, Math.min(0, d)), x0 = Math.max(a, Math.min(0, b));
          svg += '<line x1="' + sx(a) + '" y1="' + sy(y0) + '" x2="' + sx(b) + '" y2="' + sy(y0) + '" stroke="#000" stroke-width="1.8"/><line x1="' + sx(x0) + '" y1="' + sy(c) + '" x2="' + sx(x0) + '" y2="' + sy(d) + '" stroke="#000" stroke-width="1.8"/>'; }
        else if (k == 'poly') { const p = (e[1] || []).slice(0, 12).map(P); if (p.length > 1) svg += '<polygon points="' + p.map(q => sx(q[0]) + ',' + sy(q[1])).join(' ') + '" ' + S + '/>'; }
        else if (k == 'line') { const a = P(e[1]), b = P(e[2]); svg += '<line x1="' + sx(a[0]) + '" y1="' + sy(a[1]) + '" x2="' + sx(b[0]) + '" y2="' + sy(b[1]) + '" ' + S + (e[3] ? ' stroke-dasharray="6 5"' : '') + '/>'; }
        else if (k == 'circle') { const c = P(e[1]); svg += '<circle cx="' + sx(c[0]) + '" cy="' + sy(c[1]) + '" r="' + Math.abs(N(e[2])) * sc + '" ' + S + '/>'; }
        else if (k == 'arc') { const c = P(e[1]), r = Math.abs(N(e[2])) * sc, a1 = N(e[3]) * Math.PI / 180, a2 = N(e[4]) * Math.PI / 180, X = a => sx(c[0]) + r * Math.cos(a), Y = a => sy(c[1]) - r * Math.sin(a);
          svg += '<path d="M' + X(a1).toFixed(1) + ' ' + Y(a1).toFixed(1) + ' A' + r.toFixed(1) + ' ' + r.toFixed(1) + ' 0 ' + (Math.abs(a2 - a1) > Math.PI ? 1 : 0) + ' 0 ' + X(a2).toFixed(1) + ' ' + Y(a2).toFixed(1) + '" stroke="#000" stroke-width="2" fill="none"/>'; }
        else if (k == 'right') { const v = P(e[1]), a = P(e[2]), b = P(e[3]), u = (p) => { const dx = sx(p[0]) - sx(v[0]), dy = sy(p[1]) - sy(v[1]), l = Math.hypot(dx, dy) || 1; return [dx / l * 13, dy / l * 13]; }, A = u(a), B = u(b), x = sx(v[0]), y = sy(v[1]);
          svg += '<path d="M' + (x + A[0]) + ' ' + (y + A[1]) + ' L' + (x + A[0] + B[0]) + ' ' + (y + A[1] + B[1]) + ' L' + (x + B[0]) + ' ' + (y + B[1]) + '" stroke="#000" stroke-width="1.8" fill="none"/>'; }
        else if (k == 'fn') { const f = fnOf(e[1]); if (f) { const pts = []; for (let i = 0; i <= 80; i++) { const x = N(e[2]) + (N(e[3]) - N(e[2])) * i / 80, y = f(x); if (isFinite(y) && y >= Y0 - 1 && y <= Y1 + 1) pts.push(sx(x) + ',' + sy(y)); } if (pts.length > 1) svg += '<polyline points="' + pts.join(' ') + '" stroke="#1a5fd1" stroke-width="2.5" fill="none"/>'; } }
        else if (k == 'point') { const a = P(e[1]); svg += '<circle cx="' + sx(a[0]) + '" cy="' + sy(a[1]) + '" r="3.5" fill="#000"/><text x="' + (sx(a[0]) + 7) + '" y="' + (sy(a[1]) - 7) + '" font-size="16" font-weight="bold">' + esc(e[2]) + '</text>'; }
        else if (k == 'text') { const a = P(e[1]); svg += '<text x="' + sx(a[0]) + '" y="' + sy(a[1]) + '" font-size="15" text-anchor="middle" dominant-baseline="middle">' + esc(e[2]) + '</text>'; } });
    }
    return svg ? '<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg" font-family="Arial"><rect width="' + W + '" height="' + H + '" fill="#fff"/>' + svg + '</svg>' : '';
  } catch (x) { return ''; }
}
function fig_(v) { if (typeof v == 'string' && /^\s*\[/.test(v)) { try { v = JSON.parse(v); } catch (x) {} } if (Array.isArray(v)) v = figSvg_(v); const t = String(v || '').trim(); if (!/^<svg[\s>]/i.test(t) || t.length > 30000 || /<script|on\w+\s*=|javascript:|<foreignObject|href\s*=\s*["']?(?!#)/i.test(t)) return ''; return t; }

/* الواجب بيتعمل في الخلفية (Gemini ممكن ياخد دقايق والمتصفح بيقطع الاتصال): hwgen بيحط الطلب في طابور ويرجع على طول،
   وتريجر hwJob بيعمله، والصفحة بتتابع من hwlist لحد ما المسودة تظهر */
function hwGen_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); if (!AIK_()) return out_({ ok: false, e: 'nokey' });
  const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const old = jget_(f, 'hw.json'); if (old && !b.re) return out_({ ok: true, hw: old });
  if (!fileIn_(f, /(السبورة\.pdf|مصدر-الواجب\.pdf|التفريغ\.txt)$/)) return out_({ ok: false, e: 'empty' });
  /* المعلم داس «اعمل الواجب»: بيتعمل على طول جوه الطلب نفسه (من غير طابور ولا تريجر) — والصفحة بتتابع من hwlist لو الاتصال اتقطع */
  if (b.now) { const P = PropertiesService.getScriptProperties(), K = 'hws_' + b.c + '|' + b.d; P.setProperty(K, JSON.stringify({ s: 'run', t: Date.now() }));
    let r; try { r = hwMake_(b.c, b.d, b.re); } catch (x) { r = { ok: false, e: String(x && x.message || x) }; }
    if (r.ok) P.deleteProperty(K); else P.setProperty(K, JSON.stringify({ s: 'err', e: String(r.e).slice(0, 300), t: Date.now() }));
    return out_(r.ok ? { ok: true, hw: r.hw } : { ok: false, e: r.e }); }
  hwEnq_(b.c, b.d, b.re); return out_({ ok: true, pending: 1 });
}
/* يحط الحصة في طابور الواجبات (الذكاء الاصطناعي بيعمل المسودة في الخلفية، والمعلم يراجعها وينشرها) */
function hwEnq_(c, d, re) {
  const P = PropertiesService.getScriptProperties(), L = LockService.getScriptLock(); L.waitLock(15000);
  try { let q = []; try { q = JSON.parse(P.getProperty('hwq') || '[]'); } catch (x) {}
    if (!q.some(j => j.c == c && j.d == d)) q.push({ c: c, d: String(d), re: re ? 1 : 0 });
    P.setProperties({ hwq: JSON.stringify(q.slice(-30)), ['hws_' + c + '|' + d]: JSON.stringify({ s: 'run', t: Date.now() }) });
  } finally { L.releaseLock(); }
  hwKick_();
}
/* أوتوماتيك: أول ما سبورة الحصة تخلص رفع ← مسودة الواجب تتعمل لوحدها (من غير ما المعلم يدوس حاجة) */
function hwAuto_(c, id) {
  try { if (!/^[a-z0-9]{4,6}$/.test(c || '') || !id || !AIK_()) return; const fl = DriveApp.getFileById(id); if (!/(السبورة|مصدر-الواجب)\.pdf$/.test(fl.getName())) return;
    const ps = fl.getParents(); if (!ps.hasNext()) return; const f = ps.next(); if (jget_(f, 'hw.json')) return; hwEnq_(c, f.getName(), 0); } catch (x) {}
}
function hwKick_() { if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() == 'hwJob')) ScriptApp.newTrigger('hwJob').timeBased().after(1000).create(); }
function hwJob() {
  /* علامة «شغّال» في الكاش بدل قفل السكربت كله: الواجب ممكن ياخد دقايق، وقفل السكربت كان بيعطّل تسليم الواجبات والرفع وقايمة الحصص */
  const P = PropertiesService.getScriptProperties(), t0 = Date.now(), C = CacheService.getScriptCache(); if (C.get('hwjob_run')) return; C.put('hwjob_run', '1', 300);
  try {
    ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() == 'hwJob') ScriptApp.deleteTrigger(t); });
    while (Date.now() - t0 < 240000) {
      let q = []; try { q = JSON.parse(P.getProperty('hwq') || '[]'); } catch (x) {} if (!q.length) break;
      const j = q.shift(); P.setProperty('hwq', JSON.stringify(q)); let r;
      try { r = hwMake_(j.c, j.d, j.re); } catch (x) { r = { ok: false, e: String(x && x.message || x) }; }
      if (r.ok) P.deleteProperty('hws_' + j.c + '|' + j.d); else P.setProperty('hws_' + j.c + '|' + j.d, JSON.stringify({ s: 'err', e: String(r.e).slice(0, 300), t: Date.now() }));
    }
    if (JSON.parse(P.getProperty('hwq') || '[]').length) ScriptApp.newTrigger('hwJob').timeBased().after(1000).create();
  } finally { C.remove('hwjob_run'); }
}
/* ▶ Run مرة واحدة بعد التحديث: بتدّي السكربت صلاحية «يشتغل في الخلفية» (عشان الواجب يتعمل من غير ما المتصفح يستنى) */
function authHw() { ScriptApp.getProjectTriggers(); Logger.log('تمام — الواجبات هتشتغل في الخلفية'); }
function hwMake_(c, d, re) {
  const f = cls_(c, d); if (!f) return { ok: false, e: 'class' };
  const old = jget_(f, 'hw.json'); if (old && !re) return { ok: true, hw: old };
  const b = { c: c, d: d };
  /* ⚡ النسخة الخفيفة من السبورة (صور صغيرة) أسرع بكتير في القراية — ولو مش موجودة السبورة الكاملة */
  const pdf = fileIn_(f, /مصدر-الواجب\.pdf$/) || fileIn_(f, /السبورة\.pdf$/), tr = fileIn_(f, /التفريغ\.txt$/); if (!pdf && !tr) return ({ ok: false, e: 'empty' });
  const room = load_()[b.c] || {};
  const parts = [{ text: 'أنت مدرس شاطر. ده محتوى حصة «' + (room.n || '') + '» (السبورة PDF وتفريغ الكلام لو موجود). اكتب واجب منزلي على نفس الدرس بالظبط ونفس المستوى والأمثلة، وبنفس لغة المادة اللي على السبورة (لو إنجليزي يبقى بالإنجليزي، لو عربي يبقى بالعربي).\n' +
    'لو المادة بالإنجليزي (أو أي لغة غير العربي): اكتب كل حاجة بلغة المادة — العنوان ونص كل سؤال وتعليماته (Choose the correct answer / True or False / Complete …) والإجابة والشرح — من غير ولا كلمة عربي.\n' +
    'لو السؤال محتاج رسمة (هندسة، رسم بياني، خط أعداد، أعمدة) ضيف حقل "fig" = قايمة عناصر قصيرة (مش SVG) بإحداثيات رياضية (y لفوق) وبمقاسات منطقية زي السؤال، من العناصر دي بس:\n' +
    '["poly",[[0,0],[8,0],[0,6]]] مضلع · ["line",[x,y],[x,y]] خط (["line",a,b,1] متقطع) · ["circle",[x,y],r] · ["arc",[x,y],r,زاوية_البداية,زاوية_النهاية] لعلامة الزاوية · ["right",[الرأس],[نقطة على ضلع],[نقطة على الضلع التاني]] زاوية قايمة · ["point",[x,y],"A"] · ["text",[x,y],"8 cm"] تسمية · ["axes",-5,5,-5,5] محاور · ["fn","x^2-1",-3,3] منحنى · ["numline",-5,5,[[2,"A"]]] خط أعداد · ["bars",["Mon","Tue"],[3,5]] أعمدة.\n' +
    'مثال مثلث قايم: [["poly",[[0,0],[8,0],[0,6]]],["right",[0,0],[1,0],[0,1]],["text",[4,-0.7],"8 cm"],["text",[-0.8,3],"6 cm"],["text",[4.3,3.4],"x"]]. الأسئلة اللي مش محتاجة رسمة من غير fig.\n' +
    'الكسور اكتبها بالشكل 3/4 (والعدد الكسري 1 2/3) — الموقع بيعرضها بشرطة أفقية.\n' +
    'بالظبط 10 أسئلة متنوعة ومتدرجة من السهل للصعب: 4 اختيار من متعدد (4 اختيارات)، 2 صح وغلط، 2 أكمل، 2 سؤال مقالي/مسألة قصيرة.\n' +
    'رجّع JSON بس بالشكل ده: {"title":"عنوان قصير للواجب","questions":[{"type":"mcq|tf|fill|short","q":"نص السؤال","options":["..."] (للـ mcq بس),"answer":"الإجابة الصحيحة بالظبط (للـ mcq نص الاختيار الصح، وللـ tf «صح» أو «خطأ» أو True/False)","explain":"شرح سطر واحد للإجابة","fig":[...] (اختياري — للأسئلة اللي محتاجة رسمة بس)}]}' }];
  if (pdf && pdf.getSize() < 18e6) parts.push({ inline_data: { mime_type: 'application/pdf', data: Utilities.base64Encode(pdf.getBlob().getBytes()) } });
  if (tr) parts.push({ text: 'تفريغ كلام الحصة:\n' + tr.getBlob().getDataAsString().slice(0, 30000) });
  /* الواجب نصين بيتعملوا في نفس الوقت (كل نص 5 أسئلة) = تقريبًا نص الوقت */
  const half = t => parts.map((p, i) => i ? p : { text: p.text + '\n\nمهم: المرة دي اكتب ' + t + ' بس (مش الـ 10).' });
  /* ⚡ 3 طلبات في نفس الوقت (كل واحد بيكتب أسئلة أقل = أسرع) */
  let o; try { const R = aiAll_([half('4 أسئلة اختيار من متعدد (4 اختيارات)'), half('4 أسئلة: 2 صح وغلط + 2 أكمل'), half('2 سؤال مقالي/مسألة قصيرة')]);
    o = { title: (R.find(x => x && x.title) || {}).title || '', questions: [].concat(...R.map(x => (x && x.questions) || [])) }; } catch (e) { return ({ ok: false, e: String(e.message || e) }); }
  const qs = (o.questions || []).filter(q => q && q.q).slice(0, 10).map(q => ({ type: /^(mcq|tf|fill|short)$/.test(q.type) ? q.type : 'short', q: String(q.q).slice(0, 600), options: Array.isArray(q.options) ? q.options.slice(0, 6).map(String) : null, answer: String(q.answer || '').slice(0, 600), explain: String(q.explain || '').slice(0, 400), fig: fig_(q.fig) }));
  if (!qs.length) return ({ ok: false, e: 'gen' });
  const hw = { st: 'draft', at: Date.now(), title: String(o.title || '').slice(0, 120), qs: qs }; jput_(f, 'hw.json', hw);
  return ({ ok: true, hw: hw });
}
function hwPub_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const h = b.hw || {}; const qs = (h.qs || []).filter(q => q && q.q).slice(0, 15).map(q => ({ type: /^(mcq|tf|fill|short)$/.test(q.type) ? q.type : 'short', q: String(q.q).slice(0, 600), options: Array.isArray(q.options) ? q.options.slice(0, 6).map(String) : null, answer: String(q.answer || '').slice(0, 600), explain: String(q.explain || '').slice(0, 400), fig: fig_(q.fig) }));
  if (!qs.length) return out_({ ok: false, e: 'empty' });
  const hw = { st: b.pub ? 'pub' : 'draft', at: Date.now(), title: String(h.title || '').slice(0, 120), qs: qs }; jput_(f, 'hw.json', hw);
  if (b.pub) { const t = '📝 ' + (hw.title || 'الواجب') + ' — الإجابات النموذجية\n\n' + qs.map((q, i) => (i + 1) + ') ' + q.q + (q.options ? '\n   [' + q.options.join(' / ') + ']' : '') + '\n   ✅ ' + q.answer + (q.explain ? '\n   💡 ' + q.explain : '')).join('\n\n');
    const x = fileIn_(f, /الإجابات_النموذجية\.txt$/); if (x) x.setContent('﻿' + t); else f.createFile(f.getName() + '_الإجابات_النموذجية.txt', '﻿' + t, MimeType.PLAIN_TEXT); }
  CacheService.getScriptCache().remove('lb2_' + b.c);
  return out_({ ok: true, hw: hw });
}
/* ✅ تسليم الواجب بيرجع على طول: الاختيارات والصح/غلط والإجابات اللي أرقامها مطابقة بتتصحح فورًا،
   والكتابي اللي محتاج ذكاء اصطناعي بيتصحح في الخلفية (hwGradeJob) والطالب بيشوف درجته النهائية لما تخلص */
const dig_ = s => String(s == null ? '' : s).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/٫/g, '.');
function nums_(s) { return (dig_(s).match(/-?\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g) || []).map(x => { const m = x.split('/'); return m.length == 2 ? (+m[0]) / (+m[1]) : +x; }).filter(isFinite); }
function numEq_(a, k) { const A = nums_(a), K = nums_(k); if (!K.length || A.length != K.length) return false; return K.every((v, i) => Math.abs(v - A[i]) < 1e-6 * Math.max(1, Math.abs(v))); }
function hwSub_(b) {
  const f = cls_(String(b.c || '').toLowerCase(), b.d); if (!f) return out_({ ok: false, e: 'class' });
  const hw = jget_(f, 'hw.json'); if (!hw || hw.st != 'pub') return out_({ ok: false, e: 'nohw' });
  const ans = Array.isArray(b.ans) ? b.ans.map(a => String(a == null ? '' : a).slice(0, 1500)) : [], res = [], ai = [];
  hw.qs.forEach((q, i) => { const a = ans[i] || '';
    if (!a.trim()) { res[i] = { s: 0, fb: 'مفيش إجابة' }; return; }
    if (q.type == 'mcq' || q.type == 'tf') { const ok = nrm_(a) == nrm_(q.answer) || (q.type == 'tf' && /^(صح|صحيح|true|t)$/.test(nrm_(a)) == /^(صح|صحيح|true|t)$/.test(nrm_(q.answer))); res[i] = { s: ok ? 1 : 0, fb: ok ? '✔' : 'الصح: ' + q.answer }; return; }
    if (nrm_(a) == nrm_(q.answer) || (q.type == 'fill' && numEq_(a, q.answer))) { res[i] = { s: 1, fb: '✔' }; return; }
    ai.push(i); res[i] = { s: 0, fb: AIK_() ? 'بيتصحح…' : 'هيتصحح من المعلم', p: 1 }; });
  const score = res.reduce((a, x) => a + (x ? x.s : 0), 0), total = hw.qs.length, id = Utilities.getUuid().slice(0, 12);
  const L = LockService.getUserLock(); let got = false; try { got = L.tryLock(10000); } catch (x) {}
  try { const subs = jget_(f, 'hw_sub.json') || []; subs.push({ id: id, n: String(b.n || 'طالب').slice(0, 40), at: Date.now(), score: score, total: total, ans: ans, res: res, pend: ai.length && AIK_() ? ai : undefined }); jput_(f, 'hw_sub.json', subs.slice(-300)); } finally { if (got) L.releaseLock(); }
  if (ai.length && AIK_()) { try { const P = PropertiesService.getScriptProperties(); let q = []; try { q = JSON.parse(P.getProperty('hgq') || '[]'); } catch (x) {}
    q.push({ c: String(b.c || '').toLowerCase(), d: String(b.d), id: id }); P.setProperty('hgq', JSON.stringify(q.slice(-100)));
    if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() == 'hwGradeJob')) ScriptApp.newTrigger('hwGradeJob').timeBased().after(1000).create(); } catch (x) {} }
  /* 🔒 الطالب مايشوفش الدرجة ولا الإجابات الصح — بيوصله «اتسلّم» بس، والدرجة للمعلم */
  return out_({ ok: true, id: id });
}
/* الطالب بيسأل على درجته النهائية (بعد تصحيح الكتابي) */
function hwMy_(b) { return out_({ ok: false, e: 'hidden' }); }
function hwMyOld_(b) { const f = cls_(String(b.c || '').toLowerCase(), b.d); if (!f) return out_({ ok: false, e: 'class' });
  const x = (jget_(f, 'hw_sub.json') || []).find(s => s.id && s.id === String(b.id || '')); if (!x) return out_({ ok: false, e: 'nosub' });
  return out_({ ok: true, score: x.score, total: x.total, res: x.res, pend: x.pend ? x.pend.length : 0 }); }
/* 👀 المعلم: إجابات كل طالب في واجب حصة (بكود المعلم) */
function hwSubs_(b) { if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const hw = jget_(f, 'hw.json'), subs = jget_(f, 'hw_sub.json') || [];
  return out_({ ok: true, qs: hw ? hw.qs.map(q => ({ type: q.type, q: q.q, options: q.options || null, answer: q.answer, fig: q.fig || '' })) : [],
    subs: subs.map((x, i) => ({ id: x.id || ('i' + i), n: x.n, at: x.at, score: x.score, total: x.total, ans: x.ans || [], res: x.res || [], pend: x.pend ? x.pend.length : 0 })) }); }
/* ✍️ المعلم بيعدّل درجة سؤال لطالب (صح / نص / غلط) — والمجموع بيتحسب تاني */
function hwGrade_(b) { if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const f = cls_(b.c, b.d); if (!f) return out_({ ok: false, e: 'class' });
  const L = LockService.getUserLock(); let got = false; try { got = L.tryLock(10000); } catch (x) {}
  try { const subs = jget_(f, 'hw_sub.json') || [], id = String(b.id || ''), x = subs.find((y, i) => (y.id || ('i' + i)) === id); if (!x) return out_({ ok: false, e: 'nosub' });
    const i = +b.i, sc = Math.max(0, Math.min(1, +b.s || 0)); if (!(i >= 0 && i < (x.total || 99))) return out_({ ok: false });
    x.res = x.res || []; x.res[i] = { s: sc, fb: sc >= 1 ? '✔ (المعلم)' : sc > 0 ? '◐ (المعلم)' : '✖ (المعلم)', t: 1 }; if (x.pend) { x.pend = x.pend.filter(k => k !== i); if (!x.pend.length) delete x.pend; }
    x.score = x.res.reduce((a, r) => a + (r ? r.s : 0), 0); jput_(f, 'hw_sub.json', subs); return out_({ ok: true, score: x.score, total: x.total }); } finally { if (got) L.releaseLock(); } }
function hwGradeJob() {
  const C = CacheService.getScriptCache(), P = PropertiesService.getScriptProperties(), t0 = Date.now(); if (C.get('hg_run')) return; C.put('hg_run', '1', 330);
  try { ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() == 'hwGradeJob') ScriptApp.deleteTrigger(t); });
    while (Date.now() - t0 < 270000) { let q = []; try { q = JSON.parse(P.getProperty('hgq') || '[]'); } catch (x) {} if (!q.length) break;
      const j = q.shift(); P.setProperty('hgq', JSON.stringify(q));
      try { const f = cls_(j.c, j.d); if (!f) continue; const hw = jget_(f, 'hw.json'); let subs = jget_(f, 'hw_sub.json') || []; const x = subs.find(s => s.id === j.id); if (!hw || !x || !x.pend) continue;
        const ai = x.pend, ans = x.ans; let o = {};
        try { o = ai_([{ text: 'صحّح إجابات الطالب دي مقارنةً بالإجابة النموذجية. اقبل الإجابة لو المعنى صح حتى لو الصياغة مختلفة أو فيها أخطاء إملائية بسيطة، ولو الرقم صح حتى لو الوحدة مكتوبة بشكل مختلف. لكل سؤال اديله درجة 0 أو 0.5 أو 1، وملاحظة قصيرة بنفس لغة السؤال. رجّع JSON بس: {"r":[{"i":رقم,"s":درجة,"fb":"ملاحظة"}]}\n\n' +
          ai.map(i => '#' + i + '\nالسؤال: ' + hw.qs[i].q + '\nالنموذجية: ' + hw.qs[i].answer + '\nالطالب: ' + ans[i]).join('\n\n') }], 0); } catch (e) { o = {}; }
        const L = LockService.getUserLock(); let got = false; try { got = L.tryLock(10000); } catch (z) {}
        try { subs = jget_(f, 'hw_sub.json') || []; const y = subs.find(s => s.id === j.id); if (!y) continue;
          (o.r || []).forEach(r => { if (ai.indexOf(+r.i) > -1) y.res[+r.i] = { s: Math.max(0, Math.min(1, +r.s || 0)), fb: String(r.fb || '').slice(0, 300) }; });
          ai.forEach(i => { if (y.res[i] && y.res[i].p) y.res[i] = { s: 0, fb: 'هيتصحح من المعلم', p: 1 }; });
          y.score = y.res.reduce((a, r) => a + (r ? r.s : 0), 0); delete y.pend; jput_(f, 'hw_sub.json', subs); } finally { if (got) L.releaseLock(); }
      } catch (e) {} }
    if (JSON.parse(P.getProperty('hgq') || '[]').length) ScriptApp.newTrigger('hwGradeJob').timeBased().after(1000).create();
  } finally { C.remove('hg_run'); }
}
function hwList_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const P = PropertiesService.getScriptProperties(), id = P.getProperty('gf_' + b.c); if (!id) return out_({ ok: true, items: [], key: AIK_() });
  /* ⚡ أسرع: بنرتّب فولدرات الحصص بالتاريخ ونقرا أحدث 40 بس، وكل فولدر بنلف على ملفاته مرة واحدة (بدل 3 مرات) */
  const F = [], it = DriveApp.getFolderById(id).getFolders(); while (it.hasNext()) { const f = it.next(); F.push({ f: f, d: f.getName() }); }
  F.sort((a, b) => a.d < b.d ? 1 : -1);
  const all = P.getProperties(), out = [];
  for (const x of F) { if (out.length >= 40) break; const f = x.f, fs = {}; let has = false; const fi = f.getFiles();
    while (fi.hasNext()) { const y = fi.next(), n = y.getName(); if (n === 'hw.json' || n === 'hw_sub.json') fs[n] = y; else if (/(السبورة\.pdf|مصدر-الواجب\.pdf|التفريغ\.txt)$/.test(n)) has = true; }
    const rd = n => { try { return fs[n] ? JSON.parse(fs[n].getBlob().getDataAsString()) : null; } catch (e) { return null; } };
    const hw = rd('hw.json'), subs = rd('hw_sub.json') || []; if (!has && !hw) has = f.getFoldersByName(MATF).hasNext();
    let S = null; try { S = JSON.parse(all['hws_' + b.c + '|' + x.d] || 'null'); } catch (z) {}
    /* حالة الطابور: بيتعمل (لو من أقل من 10 دقايق) أو فشل وسببه */
    const run = S && S.s == 'run' && Date.now() - S.t < 600000, err = S && (S.s == 'err' || S.s == 'run' && !run) ? (S.e || 'الذكاء الاصطناعي اتأخر — جرّب تاني') : '';
    if (has || hw) out.push({ d: x.d, st: run ? 'run' : hw ? hw.st : err ? 'err' : '', e: err, hw: hw, subs: subs.map(s => ({ n: s.n, at: s.at, score: s.score, total: s.total })) }); }
  return out_({ ok: true, items: out, key: AIK_() });
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
  Object.keys(rooms).concat(Object.keys(S)).forEach(c => CacheService.getScriptCache().remove('lb2_' + c));
  Logger.log((go ? '✅ اتنفّذ' : '🔎 تجربة بس (مفيش حاجة اتغيّرت)') + ' — ملفات: ' + moved + ' · ملفات مالقيتلهاش مجموعة: ' + skip + (it.hasNext() ? ' · الوقت خلص، شغّلها تاني تكمّل' : '') + '\n' + log.slice(0, 300).join('\n'));
}

/* 📄 سبورة الحصة للمكتبة: بنبعت الـ PDF نفسه للموقع يعرضه بنفسه (معاينة Drive جوه الصفحة بتطلع سودا على الآيفون)
   بس لو الملف سبورة PDF جوه فولدر حصة تبع المجموعة دي */
/* ===== 📎 ملفات الحصة (من المعلم للطلاب) — جوه فولدر الحصة في فولدر فرعي «📎 ملفات» ===== */
const MATF = '📎 ملفات';
function matDir_(b, make) { if (!hOk_(b.c, b.h)) return null; const f = cls_(b.c, b.d); if (!f) return null; const it = f.getFoldersByName(MATF); return it.hasNext() ? it.next() : make ? f.createFolder(MATF) : null; }
function matStart_(b) {
  if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const g = matDir_(b, true); if (!g) return out_({ ok: false, e: 'class' });
  const meta = { name: String(b.name || 'ملف').replace(/[\\/:*?"<>|]/g, '_').slice(0, 150), mimeType: String(b.mime || 'application/octet-stream').split(';')[0].slice(0, 100), parents: [g.getId()] };
  const r = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true', {
    method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': meta.mimeType }, muteHttpExceptions: true });
  const h = r.getHeaders(), loc = h['Location'] || h['location']; if (!loc) return out_({ ok: false, e: 'start ' + r.getResponseCode() });
  const s = Utilities.getUuid(), c = String(b.c).toLowerCase(), C = CacheService.getScriptCache(), P = PropertiesService.getScriptProperties();
  C.put('up_' + s, loc, 21600); P.setProperty('up_' + s, loc); C.put('upc_' + s, c, 21600); P.setProperty('upc_' + s, c); C.remove('lb2_' + c);
  return out_({ ok: true, s: s });
}
function matList_(b) { if (!hOk_(b.c, b.h)) return out_({ ok: false, e: 'auth' }); const g = matDir_(b, false), L = [];
  if (g) { const it = g.getFiles(); while (it.hasNext()) { const x = it.next(); if (!x.isTrashed()) L.push({ n: x.getName(), id: x.getId(), m: x.getMimeType(), s: x.getSize(), at: x.getDateCreated().getTime() }); } }
  L.sort((a, b2) => a.at - b2.at); return out_({ ok: true, files: L }); }
function matDel_(b) { const g = matDir_(b, false); if (!g) return out_({ ok: false, e: 'auth' });
  try { const x = DriveApp.getFileById(String(b.id || '')), ps = x.getParents(); let ok = false; while (ps.hasNext()) if (ps.next().getId() == g.getId()) ok = true; if (!ok) return out_({ ok: false, e: 'nofile' }); x.setTrashed(true); } catch (e) { return out_({ ok: false, e: 'nofile' }); }
  CacheService.getScriptCache().remove('lb2_' + String(b.c).toLowerCase()); return out_({ ok: true }); }
/* صفحة HTML من المعلم: الطالب بيشوفها جوه الموقع (في صندوق مقفول مايوصلش لبيانات الطالب) — بنرجّع النص بس لو الملف فعلًا من ملفات مجموعته */
function matRaw_(b) {
  const c = String(b.c || '').toLowerCase(), gid = PropertiesService.getScriptProperties().getProperty('gf_' + c);
  if (!/^[a-z0-9]{4,6}$/.test(c) || !gid || !/^[A-Za-z0-9_-]{10,100}$/.test(String(b.id || ''))) return out_({ ok: false, e: 'bad' });
  let x; try { x = DriveApp.getFileById(b.id); } catch (e) { return out_({ ok: false, e: 'nofile' }); }
  if (x.isTrashed() || !(/html/.test(x.getMimeType()) || /\.html?$/i.test(x.getName()))) return out_({ ok: false, e: 'type' });
  let ok = false; const ps = x.getParents(); while (ps.hasNext() && !ok) { const m = ps.next(); if (m.getName() != MATF) continue; const s1 = m.getParents(); while (s1.hasNext() && !ok) { const g = s1.next().getParents(); while (g.hasNext()) if (g.next().getId() == gid) ok = true; } }
  if (!ok) return out_({ ok: false, e: 'group' }); if (x.getSize() > 5e6) return out_({ ok: false, e: 'big' });
  return out_({ ok: true, t: x.getBlob().getDataAsString('UTF-8') });
}
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

/* 🔗 خادم الربط الخاص (Render المجاني بينام بعد 15 دقيقة من غير طلبات): السكربت بيصحّيه كل 10 دقايق.
   مرة واحدة: Script properties ← PEER_HOST = اسم الخادم (زي itqan-peer.onrender.com) ← ▶ Run «peerKeepAlive» */
function peerKeepAlive() { ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() == 'peerPing') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('peerPing').timeBased().everyMinutes(10).create(); peerPing(); Logger.log('تمام — الخادم هيفضل صاحي'); }
function peerPing() { const h = PropertiesService.getScriptProperties().getProperty('PEER_HOST'); if (!h) return;
  try { const r = UrlFetchApp.fetch('https://' + h.replace(/^https?:\/\//, '').replace(/\/.*$/, '') + '/', { muteHttpExceptions: true }); Logger.log(r.getResponseCode() + ' ' + r.getContentText().slice(0, 60)); } catch (e) { Logger.log(String(e)); } }
