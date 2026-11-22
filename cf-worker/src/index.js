/* ===== خادم إتقان على Cloudflare =====
   1) /ws   — خادم ربط بدل خادم PeerJS العام: كل جهاز بيفتح اتصال واحد، والرسايل (الشات، السبورة، الأوامر)
              بتعدّي من هنا للجهاز التاني. اتصال عادي على منفذ 443، فالشبكات مابتقفلوش.
   2) /sfu/ — وسيط لخدمة الوسائط (Cloudflare Realtime SFU): المفتاح السري بيفضل هنا ومايوصلش للمتصفح.
   3) /health — للتأكد إن الخادم شغال. */

const ORIGINS = ['https://itqanacademyalex-ai.github.io', 'http://localhost:8765'];
const SFU = 'https://rtc.live.cloudflare.com/v1/apps/';
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
let TURN_C = null;
const GRACE = 12000; /* مهلة السماح لجهاز فصل لحظة */

function cors(origin) {
  const h = { 'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (ORIGINS.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
const json = (o, s, origin) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'Content-Type': 'application/json', ...cors(origin) } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url), origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
    if (url.pathname === '/health') return json({ ok: true, sfu: !!(env.CF_SFU_APP_ID && env.CF_SFU_TOKEN), turn: !!(env.CF_TURN_KEY_ID && env.CF_TURN_KEY_TOKEN), rb: 1, v: 3 }, 200, origin);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ ok: false, e: 'ws' }, 426, origin);
      if (origin && !ORIGINS.includes(origin)) return json({ ok: false, e: 'origin' }, 403, origin);
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return json({ ok: false, e: 'id' }, 400, origin);
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
    }

    /* بيانات TURN مؤقتة (Cloudflare): للأجهزة اللي شبكتها بتقفل الاتصال المباشر — بتعدّي على منفذ 443 زي أي موقع */
    if (url.pathname === '/turn') {
      if (!ORIGINS.includes(origin)) return json({ ok: false, e: 'origin' }, 403, origin);
      if (!env.CF_TURN_KEY_ID || !env.CF_TURN_KEY_TOKEN) return json({ ok: false, e: 'noturn' }, 200, origin);
      if (!TURN_C || Date.now() > TURN_C.exp) {
        const r = await fetch('https://rtc.live.cloudflare.com/v1/turn/keys/' + env.CF_TURN_KEY_ID + '/credentials/generate-ice-servers', {
          method: 'POST', headers: { Authorization: 'Bearer ' + env.CF_TURN_KEY_TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: 86400 }) });
        if (!r.ok) return json({ ok: false, e: 'turn ' + r.status }, 200, origin);
        const j = await r.json(); TURN_C = { ice: j.iceServers, exp: Date.now() + 6 * 3600e3 };
      }
      return json({ ok: true, iceServers: TURN_C.ice }, 200, origin);
    }

    if (url.pathname.startsWith('/sfu/')) {
      if (!ORIGINS.includes(origin)) return json({ ok: false, e: 'origin' }, 403, origin);
      const sub = url.pathname.slice(4);
      if (!/^\/sessions\/(new|[A-Za-z0-9_-]{8,80}(\/tracks\/new|\/tracks\/close|\/renegotiate)?)$/.test(sub)) return json({ ok: false, e: 'path' }, 404, origin);
      if (!['GET', 'POST', 'PUT'].includes(req.method)) return json({ ok: false, e: 'method' }, 405, origin);
      const body = req.method === 'GET' ? undefined : await req.text();
      if (body && body.length > 200000) return json({ ok: false, e: 'big' }, 413, origin);
      const r = await fetch(SFU + env.CF_SFU_APP_ID + sub + url.search, {
        method: req.method, body,
        headers: { Authorization: 'Bearer ' + env.CF_SFU_TOKEN, 'Content-Type': 'application/json' }
      });
      return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', ...cors(origin) } });
    }
    return json({ ok: false, e: 'notfound' }, 404, origin);
  }
};

/* ===== Hub: كل الأجهزة متوصلة بيه (بنفس أسماء PeerJS: itqan-<room> للمعلم، itqan-reg-<room> للسكرتارية، …)
   بيستخدم «الإسبات» (Hibernation): لما مفيش رسايل بينام ومابيتحسبش وقت، ونبض «أنا لسه هنا» بيرد عليه Cloudflare لوحده من غير ما يصحّيه ===== */
export class Hub {
  constructor(state, env) {
    this.state = state;
    try { state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"type":"HB"}', '{"type":"HBA"}')); } catch (e) {}
  }
  sockets(id) { return this.state.getWebSockets(id).filter(s => s.readyState === 1); }
  send(ws, o) { try { ws.send(typeof o === 'string' ? o : JSON.stringify(o)); } catch (e) {} }

  async fetch(req) {
    const url = new URL(req.url), id = url.searchParams.get('id'), token = String(url.searchParams.get('token') || '').slice(0, 64);
    /* الغرفة (اختياري): الأجهزة اللي في نفس الغرفة تقدر تبعت رسالة لكلهم مرة واحدة (استراحة الطلاب لما المعلم يخرج) */
    const room = /^[a-z0-9]{4,6}$/.test(url.searchParams.get('room') || '') ? url.searchParams.get('room') : '';
    /* نفس الاسم متوصل: لو نفس الجهاز (نفس التوكن) بيرجع بعد انقطاع ← نقفل القديم ونكمّل. جهاز تاني ← «الاسم محجوز» */
    for (const old of this.sockets(id)) {
      const a = old.deserializeAttachment() || {};
      if (a.token && a.token === token) { try { old.close(4000, 'replaced'); } catch (e) {} }
      else {
        const p = new WebSocketPair(); p[1].accept();
        this.send(p[1], { type: 'ID-TAKEN', payload: { msg: 'ID "' + id + '" is taken' } }); try { p[1].close(4001, 'taken'); } catch (e) {}
        return new Response(null, { status: 101, webSocket: p[0] });
      }
    }
    const pair = new WebSocketPair();
    this.state.acceptWebSocket(pair[1], room ? [id, 'r:' + room] : [id]);
    /* رجع خلال مهلة السماح: نلغي «مشي»، ونسلّمه الرسايل اللي اتبعتت له وهو فاصل */
    const held = this.held && this.held[id];
    if (this.held) delete this.held[id];
    let prev = null; try { prev = await this.state.storage.get('lv:' + id); await this.state.storage.delete('lv:' + id); } catch (e) {}
    pair[1].serializeAttachment({ id, token, room, peers: (prev && prev.peers || []).slice(-200) });
    this.send(pair[1], { type: 'OPEN', id });
    if (held) for (const x of held.q) this.send(pair[1], x);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw.length > 1048000) return this.send(ws, { type: 'ERROR', payload: { msg: 'too big' } });
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'HB') return this.send(ws, { type: 'HBA' });
    const a = ws.deserializeAttachment() || {}, to = String(m.dst || '');
    /* رسالة لكل اللي في الغرفة (ماعدا المرسل) */
    if (m.type === 'RB') {
      if (!a.id || !a.room) return;
      const s = JSON.stringify({ type: 'RB', src: a.id, payload: m.payload });
      for (const x of this.state.getWebSockets('r:' + a.room)) if (x !== ws && x.readyState === 1) this.send(x, s);
      return;
    }
    if (!a.id || !ID_RE.test(to)) return;
    const t = this.sockets(to);
    if (!t.length) {
      /* الجهاز فاصل لحظة (في مهلة السماح): بنحتفظ بالرسالة لحد ما يرجع، بدل ما نقول «مش موجود» */
      const h = this.held && this.held[to];
      if (h && Date.now() - h.at < GRACE) { m.src = a.id; delete m.dst; if (h.q.length < 400) h.q.push(JSON.stringify(m)); return; }
      return this.send(ws, { type: 'EXPIRE', src: to, payload: { cid: m.payload && m.payload.cid } });
    }
    /* بنفتكر مين بيكلم مين، عشان لو جهاز فصل نقول للتانيين على طول (بدل ما يستنوا) */
    if (!a.peers.includes(to)) { a.peers.push(to); if (a.peers.length > 200) a.peers.shift(); ws.serializeAttachment(a); }
    m.src = a.id; delete m.dst;
    const s = JSON.stringify(m);
    for (const x of t) {
      const b = x.deserializeAttachment() || {};
      if (b.peers && !b.peers.includes(a.id)) { b.peers.push(a.id); if (b.peers.length > 200) b.peers.shift(); x.serializeAttachment(b); }
      this.send(x, s);
    }
  }

  async webSocketClose(ws) { await this.gone(ws); }
  async webSocketError(ws) { await this.gone(ws); }
  async gone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (!a.id) return;
    /* لو نفس الاسم رجع باتصال جديد (أو اتبدل) مانقولش إنه مشي */
    if (this.sockets(a.id).some(s => s !== ws)) return;
    /* مهلة سماح: لو النت فصل لحظة ورجع خلال ثواني، محدش يحس — «مشي» بيتبعت بس لو ماارجعش */
    this.held = this.held || {};
    this.held[a.id] = { at: Date.now(), q: [] };
    try {
      await this.state.storage.put('lv:' + a.id, { peers: a.peers || [], at: Date.now() });
      const al = await this.state.storage.getAlarm(); if (!al) await this.state.storage.setAlarm(Date.now() + GRACE + 500);
    } catch (e) {}
  }
  async alarm() {
    const L = await this.state.storage.list({ prefix: 'lv:' }); let next = 0;
    for (const [k, v] of L) {
      const id = k.slice(3);
      if (this.sockets(id).length) { await this.state.storage.delete(k); continue; }
      if (Date.now() - v.at < GRACE) { next = next ? Math.min(next, v.at + GRACE) : v.at + GRACE; continue; }
      await this.state.storage.delete(k); if (this.held) delete this.held[id];
      for (const p of v.peers || []) for (const x of this.sockets(p)) this.send(x, { type: 'LEAVE', src: id });
    }
    if (next) await this.state.storage.setAlarm(next + 300);
  }
}
