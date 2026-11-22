/* ===== خادم إتقان على Cloudflare =====
   1) /ws   — خادم ربط بدل خادم PeerJS العام: كل جهاز بيفتح اتصال واحد، والرسايل (الشات، السبورة، الأوامر)
              بتعدّي من هنا للجهاز التاني. اتصال عادي على منفذ 443، فالشبكات مابتقفلوش.
   2) /sfu/ — وسيط لخدمة الوسائط (Cloudflare Realtime SFU): المفتاح السري بيفضل هنا ومايوصلش للمتصفح.
   3) /health — للتأكد إن الخادم شغال. */

const ORIGINS = ['https://itqanacademyalex-ai.github.io', 'http://localhost:8765'];
const SFU = 'https://rtc.live.cloudflare.com/v1/apps/';
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

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
    if (url.pathname === '/health') return json({ ok: true, sfu: !!(env.CF_SFU_APP_ID && env.CF_SFU_TOKEN), v: 1 }, 200, origin);

    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return json({ ok: false, e: 'ws' }, 426, origin);
      if (origin && !ORIGINS.includes(origin)) return json({ ok: false, e: 'origin' }, 403, origin);
      const id = url.searchParams.get('id') || '';
      if (!ID_RE.test(id)) return json({ ok: false, e: 'id' }, 400, origin);
      return env.HUB.get(env.HUB.idFromName('hub')).fetch(req);
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
    this.state.acceptWebSocket(pair[1], [id]);
    pair[1].serializeAttachment({ id, token, peers: [] });
    this.send(pair[1], { type: 'OPEN', id });
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(ws, raw) {
    if (typeof raw !== 'string') return;
    if (raw.length > 1048000) return this.send(ws, { type: 'ERROR', payload: { msg: 'too big' } });
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'HB') return this.send(ws, { type: 'HBA' });
    const a = ws.deserializeAttachment() || {}, to = String(m.dst || '');
    if (!a.id || !ID_RE.test(to)) return;
    const t = this.sockets(to);
    if (!t.length) return this.send(ws, { type: 'EXPIRE', src: to, payload: { cid: m.payload && m.payload.cid } });
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

  webSocketClose(ws) { this.gone(ws); }
  webSocketError(ws) { this.gone(ws); }
  gone(ws) {
    const a = ws.deserializeAttachment() || {};
    if (!a.id) return;
    /* لو نفس الاسم رجع باتصال جديد (أو اتبدل) مانقولش إنه مشي */
    if (this.sockets(a.id).some(s => s !== ws)) return;
    for (const p of a.peers || []) for (const x of this.sockets(p)) this.send(x, { type: 'LEAVE', src: a.id });
  }
}
