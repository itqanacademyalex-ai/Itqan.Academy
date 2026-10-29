/* Service worker لتطبيق إتقان (PWA)
   - الصفحة دايماً من النت (عشان أي تحديث يوصل فوراً) — مفيش تخزين للموقع نفسه
   - لو مفيش نت: صفحة «مفيش اتصال» بدل الصفحة البيضا
   - مابيلمسش أي طلبات تانية (الاتصال بالحصة، المكتبات، الإيميل...) */
const C = 'itqan-v1';
const ICON = 'icons/icon-192.png';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(C).then(c => c.add(ICON)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const offline = () => caches.match(ICON).then(r => r ? r.blob() : null).then(b => new Promise(res => {
  if (!b) return res('');
  const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => res(''); f.readAsDataURL(b);
})).then(img => new Response(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0e1a2b"><title>Itqan Academy</title>
<style>*{box-sizing:border-box;margin:0}html,body{height:100%}body{background:#0e1a2b;color:#e9eff5;font-family:Cairo,Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px}
.c{background:#14283f;border-radius:20px;padding:28px;max-width:400px;text-align:center;display:flex;flex-direction:column;gap:14px;align-items:center}
img{width:96px;height:96px;border-radius:22px}h2{font-size:20px}p{line-height:1.9;color:#c4d3e0}
button{padding:12px 24px;border-radius:12px;border:0;background:#1a9486;color:#fff;font:inherit;font-weight:700;font-size:16px}</style></head>
<body><div class="c">${img ? `<img src="${img}" alt="">` : ''}<h2>📶 مفيش اتصال بالإنترنت</h2>
<p>التطبيق محتاج إنترنت عشان يفتح الحصة. اتأكد إن النت شغّال وهنحاول تاني لوحدنا.</p>
<button onclick="location.reload()">حاول تاني</button></div>
<script>addEventListener('online',()=>location.reload());setInterval(()=>{if(navigator.onLine)location.reload()},10000)</script></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));

self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(offline));
});
