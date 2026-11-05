/**
 * سجل حصص أكاديمية إتقان (Google Apps Script)
 * - لوحة السكرتارية بترفع هنا الغرف الثابتة: بصمة مفتاح كل غرفة + مواعيدها الأسبوعية.
 * - جهاز المعلم بيسأل هنا قبل ما يفتح الحصة: هل كود المعلم صح؟ وهل ده ميعاد الحصة (من قبلها بـ 10 دقايق لحد ما تخلص)؟
 *   الوقت بيتحسب هنا بتوقيت القاهرة، مش من ساعة جهاز المعلم.
 *
 * التركيب: script.google.com ← مشروع جديد ← الصق الكود ده ← غيّر KEY ← Deploy ← New deployment ← Web app
 *          Execute as: Me ، Who has access: Anyone ← Deploy ← انسخ رابط الـ Web app.
 */
const KEY = 'PUT-YOUR-SECRET-KEY-HERE'; // نفس المفتاح اللي بيتكتب في لوحة السكرتارية مرة واحدة
const TZ = 'Africa/Cairo';
const EARLY = 10; // المعلم يقدر يفتح قبل الحصة بالدقايق دي بس

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function load_() { try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('rooms') || '{}'); } catch (e) { return {}; } }
function min_(t) { const p = String(t).split(':'); return (+p[0]) * 60 + (+p[1] || 0); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (p.a === 'chk') {
    const c = String(p.c || '').toLowerCase(), r = load_()[c];
    const now = new Date(), d = Number(Utilities.formatDate(now, TZ, 'u')) % 7; // 0 = الأحد
    const hm = Utilities.formatDate(now, TZ, 'HH:mm'), n = min_(hm);
    if (!r) return out_({ ok: true, known: false, now: hm, d: d });
    const allow = (r.s || []).some(q => +q[0] === d && n >= min_(q[1]) - EARLY && n < min_(q[1]) + (+q[2] || 60));
    return out_({ ok: true, known: true, v: r.v, allow: allow, s: r.s || [], now: hm, d: d });
  }
  return out_({ ok: false });
}

function doPost(e) {
  let b = {};
  try { b = JSON.parse(e.postData.contents || '{}'); } catch (x) { return out_({ ok: false, e: 'json' }); }
  if (b.k !== KEY) return out_({ ok: false, e: 'key' });
  if (b.a === 'put') {
    const R = {};
    (b.rooms || []).slice(0, 200).forEach(r => {
      const c = String(r.c || '').toLowerCase();
      if (!/^[a-z0-9]{4,6}$/.test(c)) return;
      R[c] = { v: String(r.v || '').slice(0, 20), s: (r.s || []).filter(q => Array.isArray(q) && q[0] >= 0 && q[0] <= 6 && /^\d{1,2}:\d{2}$/.test(q[1])).slice(0, 30).map(q => [+q[0], q[1], +q[2] || 60]) };
    });
    PropertiesService.getScriptProperties().setProperty('rooms', JSON.stringify(R));
    return out_({ ok: true, n: Object.keys(R).length });
  }
  return out_({ ok: false });
}
