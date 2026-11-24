/* ===== 🌐 محوّل خادم إتقان (Cloudflare) =====
   بيتكلم بنفس لغة مكتبة PeerJS (Peer / connect / call / on('connection') / on('call') …) عشان باقي البرنامج يفضل زي ما هو،
   بس بدل الاتصال المباشر بين الأجهزة:
   - الرسايل (الشات، السبورة، الأوامر) بتعدّي على خادم إتقان (اتصال واحد عادي على منفذ 443).
   - الصوت والصورة بيترفعوا مرة واحدة لـ Cloudflare، وهو بيوزّعهم (SFU) — المعلم مابيرفعش نسخة لكل طالب.
   بيشتغل بس على الغرف اللي في HUB_ROOMS، والباقي على الطريقة القديمة. */
(function () {
  const HUB = 'https://itqan-hub.itqanacademy-alex.workers.dev';
  const WS = HUB.replace(/^http/, 'ws') + '/ws';
  /* 🔀 مفتاح النقل: HUB_ALL = كل الغرف على خادم إتقان. للرجوع السريع للطريقة القديمة: HUB_ALL = false
     (وغرف معيّنة ممكن تتحط في HUB_OFF عشان تفضل على القديم، أو في HUB_ROOMS عشان تبقى على الجديد) */
  const HUB_ALL = true;
  const HUB_OFF = [];
  const HUB_ROOMS = ['5wpt'];
  const ICE = [{ urls: 'stun:stun.cloudflare.com:3478' }];

  const rid = () => { const a = crypto.getRandomValues(new Uint8Array(12)); return Array.from(a, x => 'abcdefghijklmnopqrstuvwxyz0123456789'[x % 36]).join(''); };
  /* 📊 لو استهلاك Cloudflare الشهر ده قرّب من الحد المجاني، كل الغرف بتشتغل بالطريقة القديمة (مفيش فلوس تتسحب) */
  try { const c = JSON.parse(sessionStorage.getItem('itqan_hubcap') || 'null'); if (c && Date.now() - c.at < 600000) window.HUB_CAP = c.cap; } catch (e) {}
  if (window.HUB_CAP === undefined) fetch(HUB + '/health', { cache: 'no-store' }).then(r => r.json()).then(j => { window.HUB_CAP = !!(j && j.cap); window.HUB_USE = j; try { sessionStorage.setItem('itqan_hubcap', JSON.stringify({ cap: window.HUB_CAP, at: Date.now() })); } catch (e) {} }).catch(() => {});
  window.HUBR = r => { const c = String(r || '').toLowerCase(); if (!c || HUB_OFF.includes(c) || window.HUB_OLD || window.HUB_CAP) return false; return HUB_ALL || HUB_ROOMS.includes(c); };
  /* الكلاس المناسب للغرفة: محوّل إتقان أو PeerJS العادي */
  window.PC = r => (window.HUBR(r) ? HubPeer : window.Peer);
  const log = (...a) => { try { console.log('[hub]', ...a); } catch (e) {} };

  class Em {
    constructor() { this._h = {}; }
    on(e, f) { (this._h[e] = this._h[e] || []).push(f); return this; }
    once(e, f) { const g = (...a) => { this.off(e, g); f(...a); }; return this.on(e, g); }
    off(e, f) { if (!f) delete this._h[e]; else this._h[e] = (this._h[e] || []).filter(x => x !== f); return this; }
    emit(e, ...a) { (this._h[e] || []).slice().forEach(f => { try { f(...a); } catch (x) { console.error(x); } }); }
  }

  /* خوادم TURN من Cloudflare (لو متفعّلة على الخادم) — بتتجاب مرة كل كام ساعة */
  let iceC = null;
  async function hubIce() {
    if (iceC && Date.now() < iceC.exp) return iceC.ice;
    try {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 6000);
      const j = await fetch(HUB + '/turn', { signal: ac.signal }).then(r => r.json()).finally(() => clearTimeout(t));
      if (j && j.ok && Array.isArray(j.iceServers) && j.iceServers.length) { iceC = { ice: j.iceServers, exp: Date.now() + 4 * 3600e3 }; return iceC.ice; }
    } catch (e) {}
    return ICE;
  }
  /* 🔊 صوت أثبت: لو جزء صغير من الصوت ضاع في السكة (نت ضعيف في الرفع) بيطلع «زي الروبوت».
     بنطلب من Opus يبعت مع كل جزء نسخة مضغوطة من اللي قبله (FEC) ويرفع حدّه شوية — الجزء اللي يضيع بيترجّع بدل ما يتألّف */
  function opusSafe(sdp) {
    try {
      const m = /a=rtpmap:(\d+) opus\/48000[^\r\n]*/i.exec(sdp); if (!m) return sdp;
      const pt = m[1], re = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
      const add = p => { const has = k => new RegExp('(^|;)\\s*' + k + '=').test(p); if (!has('useinbandfec')) p += ';useinbandfec=1'; if (!has('usedtx')) p += ';usedtx=0'; return p.replace(/^;/, ''); };
      return re.test(sdp) ? sdp.replace(re, (x, p) => 'a=fmtp:' + pt + ' ' + add(p)) : sdp.replace(m[0], m[0] + '\r\na=fmtp:' + pt + ' ' + add(''));
    } catch (e) { return sdp; }
  }
  /* ---------- الصوت والصورة: جلسة واحدة لكل جهاز مع Cloudflare SFU ---------- */
  class SFU {
    constructor(hp) { this.hp = hp; this.q = Promise.resolve(); this.reset(); }
    reset() { try { this.pc && this.pc.close(); } catch (e) {} this.pc = null; this.sid = null; this.pub = new Map(); this.pull = new Map(); this.byMid = {}; this.wait = {}; this.gen = (this.gen || 0) + 1; }
    run(f) { const p = this.q.then(f, f); this.q = p.catch(() => {}); return p; }
    async api(path, method, body) {
      const ac = new AbortController(), t = setTimeout(() => ac.abort(), 12000);
      try {
        const r = await fetch(HUB + '/sfu' + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
        const j = await r.json(); if (j.errorCode) throw new Error(j.errorCode + ' ' + (j.errorDescription || '')); return j;
      } finally { clearTimeout(t); }
    }
    async init() {
      if (this.sid) return;
      const pc = this.pc = new RTCPeerConnection({ iceServers: await hubIce(), bundlePolicy: 'max-bundle', iceTransportPolicy: window.HUB_RELAY ? 'relay' : 'all' });
      const gen = this.gen;
      pc.ontrack = e => { const mid = e.transceiver && e.transceiver.mid; if (mid == null) return; this.byMid[mid] = e.track; const w = this.wait[mid]; if (w) { delete this.wait[mid]; w(e.track); } };
      let dt = 0;
      pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState; log('ice', s);
        clearTimeout(dt);
        if (s === 'connected' || s === 'completed') this.rs = 0;
        /* النت فصل لحظة: الأول بنجرّب «إعادة اتصال خفيفة» (نفس الجلسة، الصوت بيكمّل بعدها على طول)، ولو Cloudflare مارضيش أو ماتصلّحتش ← إعادة بناء كاملة زي الأول */
        if (s === 'failed') this.restart(gen);
        else if (s === 'disconnected') dt = setTimeout(() => { if (pc.iceConnectionState === 'disconnected') this.restart(gen); }, 3000);
      };
      /* بنفتح الجلسة بقناة بيانات صغيرة عشان الاتصال بـ Cloudflare يكمل حتى لو الجهاز بيستقبل بس (طالب لسه مافتحش المايك) */
      try { pc.createDataChannel('itqan'); } catch (e) {}
      await pc.setLocalDescription(await pc.createOffer());
      const j = await this.api('/sessions/new', 'POST', { sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp } });
      await pc.setRemoteDescription(new RTCSessionDescription(j.sessionDescription));
      this.sid = j.sessionId;
      this.ready = new Promise(ok => {
        const done = () => { const s = pc.iceConnectionState; if (s === 'connected' || s === 'completed') { pc.removeEventListener('iceconnectionstatechange', done); ok(1); } };
        pc.addEventListener('iceconnectionstatechange', done); done(); setTimeout(() => ok(0), 30000);
      });
    }
    async sdpPublish(add) {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      let j = null;
      /* الاتصال بـ Cloudflare لسه بيكمل (شبكة بطيئة): بنستنى ونعيد بدل ما نستسلم */
      for (let i = 0; i < 6; i++) {
        try { j = await this.api('/sessions/' + this.sid + '/tracks/new', 'POST', { sessionDescription: { type: 'offer', sdp: this.pc.localDescription.sdp }, tracks: add.map(p => ({ location: 'local', mid: p.tr.mid, trackName: p.name })) }); break; }
        catch (e) { if (!/not ready/i.test(e.message) || i === 5) throw e; log('session not ready, waiting'); await new Promise(r => setTimeout(r, 3000)); }
      }
      await this.pc.setRemoteDescription(new RTCSessionDescription({ type: j.sessionDescription.type, sdp: opusSafe(j.sessionDescription.sdp) }));
    }
    /* رفع: نفس التراك (زي صورة المعلم) بيترفع مرة واحدة بس مهما كان عدد الطلاب */
    /* بنجهّز الجلسة ونستنى الاتصال برّه الطابور — عشان جهاز بطيء الاتصال مايوقفش باقي الطلبات (زمان كان ممكن يعلّق الكل 30 ثانية) */
    async prep() { await this.run(() => this.init()); await this.ready; }
    async publish(tracks) {
      await this.prep(); const gen = this.gen;
      return this.run(async () => {
        if (gen !== this.gen) await this.init();
        const names = [], add = [];
        for (const t of tracks) {
          if (!t) continue; let p = this.pub.get(t.id);
          if (p) { p.ref++; names.push(p.name); continue; }
          const tr = this.pc.addTransceiver(t, { direction: 'sendonly' });
          p = { tr, name: t.kind + '-' + rid(), ref: 1, track: t }; this.pub.set(t.id, p); add.push(p); names.push(p.name);
        }
        if (add.length) await this.sdpPublish(add);
        return { sid: this.sid, names };
      });
    }
    unpublish(tracks) {
      return this.run(async () => {
        const mids = [];
        for (const t of tracks) { const p = t && this.pub.get(t.id); if (!p || --p.ref > 0) continue; this.pub.delete(t.id); if (p.tr.mid != null) mids.push(p.tr.mid); try { p.tr.stop(); } catch (e) {} }
        if (mids.length && this.sid) await this.closeMids(mids);
      }).catch(e => log('unpublish', e));
    }
    async closeMids(mids) {
      await this.pc.setLocalDescription(await this.pc.createOffer());
      const j = await this.api('/sessions/' + this.sid + '/tracks/close', 'PUT', { tracks: mids.map(m => ({ mid: m })), sessionDescription: { type: 'offer', sdp: this.pc.localDescription.sdp }, force: false });
      if (j.sessionDescription) await this.pc.setRemoteDescription(new RTCSessionDescription(j.sessionDescription));
    }
    /* استقبال: بنسحب تراكات جهاز تاني من Cloudflare */
    async pullTracks(sid, names) {
      await this.prep(); const gen = this.gen;
      let need = await this.run(async () => { const need = []; for (const n of names) { const k = sid + '|' + n, p = this.pull.get(k); if (p) p.ref++; else need.push(n); } return need; });
      /* المعلم لسه بيبدأ يبعت: كل محاولة طلب لوحدها في الطابور، والاستنى بينهم برّه الطابور (باقي الطلبات تمشي) — لحد ~15 ثانية */
      for (let i = 0; i < 6 && need.length; i++) {
        if (gen !== this.gen) throw new Error('reset');
        need = await this.run(async () => {
          let j;
          try { j = await this.api('/sessions/' + this.sid + '/tracks/new', 'POST', { tracks: need.map(n => ({ location: 'remote', sessionId: sid, trackName: n })) }); }
          catch (e) { log('pull retry', e.message); return need; }
          if (j.requiresImmediateRenegotiation && j.sessionDescription) {
            await this.pc.setRemoteDescription(new RTCSessionDescription(j.sessionDescription));
            await this.pc.setLocalDescription(await this.pc.createAnswer());
            await this.api('/sessions/' + this.sid + '/renegotiate', 'PUT', { sessionDescription: { type: 'answer', sdp: this.pc.localDescription.sdp } });
          }
          const fail = [];
          (j.tracks || []).forEach(t => { if (!t.errorCode && t.mid != null) this.pull.set(sid + '|' + t.trackName, { mid: t.mid, ref: 1 }); else fail.push(t.trackName); });
          return fail;
        });
        if (need.length) { log('tracks not ready yet', need.length); await new Promise(r => setTimeout(r, 1000 + 500 * i)); }
      }
      return names.map(n => this.pull.get(sid + '|' + n)).filter(Boolean);
    }
    track(mid) {
      if (this.byMid[mid]) return Promise.resolve(this.byMid[mid]);
      return new Promise(res => { this.wait[mid] = res; setTimeout(() => { if (this.wait[mid] === res) { delete this.wait[mid]; res(null); } }, 15000); });
    }
    unpull(sid, names) {
      return this.run(async () => {
        const mids = [];
        for (const n of names) { const k = sid + '|' + n, p = this.pull.get(k); if (!p || --p.ref > 0) continue; this.pull.delete(k); mids.push(p.mid); delete this.byMid[p.mid];
          const tr = this.pc && this.pc.getTransceivers().find(x => x.mid === p.mid); try { tr && tr.stop(); } catch (e) {} }
        if (mids.length && this.sid) await this.closeMids(mids);
      }).catch(e => log('unpull', e));
    }
    sendersFor(tracks) { return tracks.map(t => { const p = t && this.pub.get(t.id); return p && p.tr.sender; }).filter(Boolean); }
    receiversFor(mids) { if (!this.pc) return []; return this.pc.getTransceivers().filter(x => mids.includes(x.mid)).map(x => x.receiver); }
    restart(gen) {
      if (gen !== this.gen || this.healing) return;
      if (this.rs) return this.heal(gen);
      this.rs = 1; const pc = this.pc; log('ice restart');
      this.run(async () => {
        if (gen !== this.gen || !pc || pc.signalingState !== 'stable') throw new Error('busy');
        pc.restartIce(); await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
        const j = await this.api('/sessions/' + this.sid + '/renegotiate', 'PUT', { sessionDescription: { type: 'offer', sdp: pc.localDescription.sdp } });
        if (!j || !j.sessionDescription || j.sessionDescription.type !== 'answer') throw new Error('no answer');
        await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: opusSafe(j.sessionDescription.sdp) }));
      }).then(() => { setTimeout(() => { const s = pc.iceConnectionState; if (gen === this.gen && s !== 'connected' && s !== 'completed') this.heal(gen); }, 8000); })
        .catch(e => { log('ice restart failed', e.message); this.heal(gen); });
    }
    /* الاتصال بـ Cloudflare وقع (الشبكة اتغيّرت مثلًا): جلسة جديدة، ونرفع ونسحب كل حاجة تاني، والمكالمات تكمّل من غير ما تتقفل */
    heal(gen) {
      if (gen !== this.gen || this.healing) return; this.healing = 1; this.rs = 0; log('heal');
      const outs = Object.values(this.hp.calls).filter(c => c._out && c.open), ins = Object.values(this.hp.calls).filter(c => !c._out && c._sid && c.open);
      this.reset();
      (async () => {
        for (const c of outs) { c._names = null; try { await c._publish(true); } catch (e) { log('heal pub', e); } }
        for (const c of ins) { c._mids = []; try { await c._pull(); } catch (e) { log('heal pull', e); } }
      })().finally(() => { this.healing = 0; });
    }
    close() { this.reset(); }
  }

  /* ---------- قناة رسايل (زي DataConnection في PeerJS) ---------- */
  class HubConn extends Em {
    constructor(hp, peer, cid, md) { super(); this.hp = hp; this.peer = peer; this.cid = cid; this.connectionId = cid; this.metadata = md; this.open = false; this.reliable = true; this.label = cid; this.type = 'data'; }
    _opened() { if (this.open || this._x) return; this.open = true; setTimeout(() => this.emit('open'), 0); }
    send(d) {
      if (this._x) return;
      let s; try { s = JSON.stringify(d); } catch (e) { return; }
      if (s === undefined) return;
      /* رسالة كبيرة (صفحة PDF عالية الدقة، أو السبورة كلها لطالب داخل متأخر): الخادم مابيقبلش أكتر من 1 ميجا ← بنقسّمها أجزاء والطرف التاني بيجمّعها */
      if (s.length <= 450000) { this.hp._send(this.peer, 'D', { cid: this.cid, d }); return; }
      const id = rid(), n = Math.ceil(s.length / 450000);
      for (let i = 0; i < n; i++) this.hp._send(this.peer, 'DP', { cid: this.cid, id, i, n, s: s.slice(i * 450000, (i + 1) * 450000) });
    }
    _part(p) {
      if (!p.id || !(p.n > 0) || p.n > 200 || !(p.i >= 0) || p.i >= p.n || typeof p.s !== 'string') return;
      const B = this._parts || (this._parts = {}), b = B[p.id] || (B[p.id] = { n: p.n, got: 0, a: [], t: Date.now() });
      if (b.a[p.i] === undefined) { b.a[p.i] = p.s; b.got++; }
      Object.keys(B).forEach(k => { if (Date.now() - B[k].t > 120000) delete B[k]; });
      if (b.got < b.n) return; delete B[p.id];
      let d; try { d = JSON.parse(b.a.join('')); } catch (e) { return; }
      setTimeout(() => this.emit('data', d), 0);
    }
    close() { if (this._x) return; this.hp._send(this.peer, 'DCX', { cid: this.cid }); this._closed(); }
    _closed() { if (this._x) return; this._x = 1; this.open = false; delete this.hp.conns[this.cid]; this.emit('close'); }
  }

  /* ---------- مكالمة صوت/صورة (زي MediaConnection في PeerJS) ---------- */
  class HubCall extends Em {
    constructor(hp, peer, cid, md) {
      super(); this.hp = hp; this.peer = peer; this.cid = cid; this.connectionId = cid; this.metadata = md || {}; this.open = false; this.type = 'media'; this._mids = [];
      const self = this;
      /* بعض أجزاء البرنامج بتقرا إحصائيات الاتصال أو بتظبط الجودة — بنديها واجهة شبه RTCPeerConnection لتراكات المكالمة دي بس */
      /* حالة المكالمة دي بالذات (مش حالة الاتصال كله بـ Cloudflare): لو السحب فشل أو الصوت ماوصلش في 15 ثانية بتبقى failed —
         وده اللي بيخلّي البرنامج يطلب من المعلم يتصل تاني لوحده (زمان كانت بتبان «متوصل» والطالب فاضل مش سامع) */
      const st = () => {
        if (self._x || self._fail) return 'failed';
        if (!self._out && self._answered && !self._ok && Date.now() - self._t0 > 15000) return 'failed';
        const pc = hp._sfu && hp._sfu.pc; return pc ? pc.connectionState : 'new';
      };
      this.peerConnection = {
        getSenders: () => self._out ? hp.sfu().sendersFor(self.localStream ? self.localStream.getTracks() : []) : [],
        getReceivers: () => hp.sfu().receiversFor(self._mids),
        /* إحصائيات التراكات بتاعة المكالمة دي بس (عشان «الصوت وقف؟» يتقاس صح) */
        getStats: async () => {
          const parts = self._out ? hp.sfu().sendersFor(self.localStream ? self.localStream.getTracks() : []) : hp.sfu().receiversFor(self._mids), m = new Map();
          for (const x of parts) { try { (await x.getStats()).forEach((v, k) => m.set(k, v)); } catch (e) {} }
          return m;
        },
        get iceConnectionState() { const s = st(); return s === 'connected' ? 'connected' : s; },
        get connectionState() { return st(); },
        addEventListener() {}, removeEventListener() {}
      };
    }
    async _publish(re) {
      const r = await this.hp.sfu().publish(this.localStream.getTracks());
      if (this._x) { this.hp.sfu().unpublish(this.localStream.getTracks()); return; }
      this._names = r.names; this.open = true;
      this.hp._send(this.peer, re ? 'CALLUP' : 'CALL', { cid: this.cid, md: this.metadata, sid: r.sid, tn: r.names });
    }
    _startOut(stream) {
      this._out = 1; this.localStream = stream;
      this._publish(false).catch(e => { log('publish failed', e); this._fail = 1; this.emit('error', { type: 'webrtc', message: String(e) }); this._closed(true); });
    }
    answer() { if (this._out || this._answered) return; this._answered = 1; this._t0 = Date.now(); this.open = true; this._pull().catch(e => { log('pull failed', e); if (e && e.message === 'reset') return; /* الجلسة اتعادت والسحب بيتعمل من جديد لوحده */ this._fail = 1; this.emit('error', { type: 'webrtc', message: String(e) }); }); }
    async _pull() {
      const sfu = this.hp.sfu(), sid = this._sid, tn = this._tn.slice();
      const ps = await sfu.pullTracks(sid, tn);
      if (this._x || sid !== this._sid) { sfu.unpull(sid, tn); return; }
      this._mids = ps.map(p => p.mid); this._pulled = { sid, tn };
      const rs = this.remoteStream || (this.remoteStream = new MediaStream());
      const tracks = (await Promise.all(this._mids.map(m => sfu.track(m)))).filter(Boolean);
      if (this._x) return;
      rs.getTracks().forEach(t => { if (!tracks.includes(t)) rs.removeTrack(t); });
      tracks.forEach(t => { if (!rs.getTracks().includes(t)) rs.addTrack(t); });
      if (!tracks.length) { this._fail = 1; log('no tracks arrived'); return; }
      /* الصورة وصلت بس الصوت لأ: نعتبر المكالمة فشلت عشان المعلم يتصل تاني (بدل «ميكروفون المعلم مقفول» وهو مش مقفول) */
      if (tn.some(n => /^audio-/.test(n)) && !tracks.some(t => t.kind === 'audio')) { this._fail = 1; log('audio missing'); }
      else { this._ok = 1; this._fail = 0; }
      this.emit('stream', rs);
    }
    /* الطرف التاني عمل جلسة جديدة مع Cloudflare: نسحب التراكات من مكانها الجديد */
    _re(sid, tn) { const old = this._pulled; this._sid = sid; this._tn = tn; if (!this._answered) return; if (old) this.hp.sfu().unpull(old.sid, old.tn); this._pull().catch(e => log('re-pull', e)); }
    close() { if (this._x) return; this.hp._send(this.peer, 'CALLX', { cid: this.cid }); this._closed(); }
    _closed() {
      if (this._x) return; this._x = 1; this.open = false; delete this.hp.calls[this.cid];
      if (this._out && this._names && this.localStream) this.hp.sfu().unpublish(this.localStream.getTracks());
      if (this._pulled) this.hp.sfu().unpull(this._pulled.sid, this._pulled.tn);
      this.emit('close');
    }
  }

  /* ---------- الجهاز نفسه (زي Peer في PeerJS) ---------- */
  class HubPeer extends Em {
    constructor(id, opts) {
      super(); if (id && typeof id === 'object') { opts = id; id = null; }
      this.id = id || rid() + rid(); this._tok = rid() + rid(); this.options = opts || {};
      this.open = false; this.disconnected = false; this.destroyed = false; this.conns = {}; this.calls = {}; this._q = [];
      this.room = String((this.options && this.options.room) || window.HUBROOM || '').toLowerCase();
      setTimeout(() => this._connect(), 0);
    }
    sfu() {
      if (!this._sfu) { this._sfu = new SFU(this); this._ut = setInterval(() => this._use(), 60000); }
      return this._sfu;
    }
    async _use() {
      try {
        const pc = this._sfu && this._sfu.pc; if (!pc) return; let b = 0;
        (await pc.getStats()).forEach(x => { if (x.type === 'transport' && x.bytesReceived) b += x.bytesReceived; });
        const key = this._sfu.sid || '', last = this._ub && this._ub.k === key ? this._ub.b : 0, d = Math.max(0, b - last);
        this._ub = { k: key, b }; if (d > 0) this._raw(JSON.stringify({ type: 'USE', b: d }));
      } catch (e) {}
    }
    /* تجهيز الاتصال بـ Cloudflare من بدري (قبل أول مكالمة) — الصوت بيوصل أسرع لما الطالب أو المشرف يدخل */
    warm() { const f = this.sfu(); f.run(() => f.init()).catch(() => {}); }
    /* جلسة جديدة مع Cloudflare (لو الجهاز مش سامع حاجة رغم إن الاتصال «متوصل») — المكالمات بتكمّل من غير ما تتقفل */
    rebuild() { const f = this._sfu; if (f && f.sid) { f.rs = 0; f.heal(f.gen); } }
    _connect() {
      if (this.destroyed) return;
      let w; try { w = this.ws = new WebSocket(WS + '?id=' + encodeURIComponent(this.id) + '&token=' + this._tok + (this.room ? '&room=' + encodeURIComponent(this.room) : '')); } catch (e) { setTimeout(() => this._connect(), 3000); return; }
      const t0 = setTimeout(() => { if (this.ws === w && w.readyState !== 1) { try { w.close(); } catch (e) {} } }, 12000);
      w.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } this._msg(m); };
      w.onclose = () => {
        clearTimeout(t0); if (this.ws !== w) return; this.ws = null; clearInterval(this._hb);
        const was = this.open; this.open = false; if (this.destroyed) return;
        if (!this._ever) { this.emit('error', { type: 'network', message: 'Lost connection to server.' }); }
        if (!this.disconnected) { this.disconnected = true; this.emit('disconnected', this.id); }
        /* بنرجع نتوصل لوحدنا (لو البرنامج ماعملهاش) */
        if (!this._manual) setTimeout(() => { if (this.disconnected && !this.destroyed && !this._manual && !this.ws) { this.disconnected = false; this._connect(); } }, was ? 800 : 2500);
      };
      w.onerror = () => {};
    }
    _msg(m) {
      const p = m.payload || {}, cid = p.cid;
      switch (m.type) {
        case 'OPEN':
          this.open = true; this.disconnected = false; const first = !this._ever; this._ever = 1;
          clearInterval(this._hb); this._hb = setInterval(() => { if (this.ws && this.ws.readyState === 1) this.ws.send('{"type":"HB"}'); }, 15000);
          { const q = this._q; this._q = []; q.forEach(s => this._raw(s)); }
          if (first) this.emit('open', this.id);
          break;
        case 'ID-TAKEN':
          this._manual = 1; this.emit('error', { type: 'unavailable-id', message: 'ID "' + this.id + '" is taken' });
          if (this._ever) this.disconnect(); else this.destroy();
          break;
        case 'EXPIRE': this.emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + m.src }); break;
        case 'LEAVE':
          Object.values(this.conns).filter(c => c.peer === m.src).forEach(c => c._closed());
          Object.values(this.calls).filter(c => c.peer === m.src).forEach(c => c._closed());
          break;
        case 'DC': {
          if (!cid || this.conns[cid]) return;
          const c = new HubConn(this, m.src, cid, p.md); this.conns[cid] = c;
          this._send(m.src, 'DCOK', { cid }); this.emit('connection', c); c._opened(); break;
        }
        case 'DCOK': { const c = this.conns[cid]; if (c) c._opened(); break; }
        case 'D': { const c = this.conns[cid]; if (c && c.peer === m.src) { if (!c.open) c._opened(); setTimeout(() => c.emit('data', p.d), 0); } else this._send(m.src, 'DCX', { cid }); break; }
        case 'DP': { const c = this.conns[cid]; if (c && c.peer === m.src) { if (!c.open) c._opened(); c._part(p); } break; }
        case 'DCX': { const c = this.conns[cid]; if (c && c.peer === m.src) c._closed(); break; }
        case 'CALL': {
          if (!cid || this.calls[cid]) return;
          const c = new HubCall(this, m.src, cid, p.md); c._sid = p.sid; c._tn = p.tn || []; this.calls[cid] = c; this.emit('call', c); break;
        }
        case 'CALLUP': { const c = this.calls[cid]; if (c && c.peer === m.src) c._re(p.sid, p.tn || []); break; }
        case 'CALLX': { const c = this.calls[cid]; if (c && c.peer === m.src) c._closed(); break; }
        /* رسايل الغرفة (للكل أو لجهاز واحد) — بتستخدمها «استراحة الطلاب» */
        case 'RB': case 'RD': this.emit('rb', m.src, m.payload, m.type === 'RD'); break;
      }
    }
    _raw(s) { if (this.ws && this.ws.readyState === 1 && this.open) this.ws.send(s); else if (this._q.length < 800) this._q.push(s); }
    _send(dst, type, payload) {
      let s; try { s = JSON.stringify({ type, dst, payload }); } catch (e) { return; }
      if (s.length > 1000000) { log('message too big', s.length); return; }
      this._raw(s);
    }
    broadcast(obj) { if (this.room) this._raw(JSON.stringify({ type: 'RB', payload: obj })); }
    tell(dst, obj) { this._send(dst, 'RD', obj); }
    /* صوت مباشر بين الطلاب (من غير المعلم): رفع تراك، وسحب تراكات جهاز تاني كـ MediaStream */
    async pubTracks(tracks) { return this.sfu().publish(tracks); }
    unpubTracks(tracks) { return this._sfu && this._sfu.unpublish(tracks); }
    async pullStream(sid, names) {
      const sfu = this.sfu(), ps = await sfu.pullTracks(sid, names), ms = new MediaStream();
      (await Promise.all(ps.map(p => sfu.track(p.mid)))).filter(Boolean).forEach(t => ms.addTrack(t));
      return ms;
    }
    unpullStream(sid, names) { return this._sfu && this._sfu.unpull(sid, names); }
    connect(dst, o) { const c = new HubConn(this, dst, rid(), o && o.metadata); this.conns[c.cid] = c; this._send(dst, 'DC', { cid: c.cid, md: c.metadata }); return c; }
    call(dst, stream, o) { const c = new HubCall(this, dst, rid(), o && o.metadata); this.calls[c.cid] = c; c._startOut(stream); return c; }
    reconnect() { if (this.destroyed) throw new Error('destroyed'); if (!this.disconnected || this.ws) return; this._manual = 0; this.disconnected = false; this._connect(); }
    disconnect() { if (this.disconnected) return; this._manual = 1; this.disconnected = true; this.open = false; const w = this.ws; this.ws = null; clearInterval(this._hb); try { w && w.close(); } catch (e) {} this.emit('disconnected', this.id); }
    destroy() {
      if (this.destroyed) return;
      Object.values(this.conns).forEach(c => c.close()); Object.values(this.calls).forEach(c => c.close());
      this.destroyed = true; this._manual = 1; this.open = false; this.disconnected = true; clearInterval(this._hb);
      const w = this.ws; this.ws = null; setTimeout(() => { try { w && w.close(); } catch (e) {} }, 300);
      clearInterval(this._ut); try { this._use(); } catch (e) {}
      try { this._sfu && this._sfu.close(); } catch (e) {}
      this.emit('close');
    }
  }
  window.HubPeer = HubPeer;
})();
