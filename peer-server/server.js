// خادم الربط الخاص بأكاديمية إتقان: بيعرّف أجهزة المعلم والطلاب على بعض أول الحصة (الصوت والصورة بيروحوا مباشرة بينهم مش من هنا)
const express = require('express');
const { ExpressPeerServer } = require('peer');

const app = express();
const port = process.env.PORT || 9000;

app.get('/', (req, res) => res.type('text').send('Itqan Academy peer server — OK'));

const server = app.listen(port, () => console.log('Itqan peer server on port ' + port));
const peerServer = ExpressPeerServer(server, {
  path: '/',
  proxied: true,          // ورا HTTPS بتاع Render
  allow_discovery: false, // محدش يقدر يعرض كل الغرف المفتوحة
  alive_timeout: 60000,
  expire_timeout: 5000,
  concurrent_limit: 5000,
});
app.use('/peerjs', peerServer);

peerServer.on('error', e => console.error('peer error', e && e.message));
