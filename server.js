// Trendo backend (powered by Protipark)
// 1) POST /api/analyze {url, qty}  -> estima nombre/precio/peso/categoria del link
// 2) POST /api/lead {payload}      -> envia el formulario completo (JSON) a ceo@protipark.com
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }));

const PORT = process.env.PORT || 8080;
const RMB_USD = 7.15;

// --- catalogo (mismo que el frontend) ---
const CATS = {
  textil:{name:'Ropa y moda',w:.30,ep:5}, belleza:{name:'Belleza y cuidado personal',w:.15,ep:4},
  accel:{name:'Accesorios de celular',w:.08,ep:3}, electro:{name:'Electronica de consumo',w:.30,ep:12},
  hogar:{name:'Hogar y organizacion',w:.50,ep:6}, fitness:{name:'Fitness y deportes',w:.40,ep:8},
  mascotas:{name:'Mascotas',w:.30,ep:6}, juguetes:{name:'Juguetes y juegos',w:.30,ep:5},
  joyeria:{name:'Joyeria y bisuteria',w:.05,ep:3}, bebes:{name:'Bebes y maternidad',w:.30,ep:6},
  herram:{name:'Herramientas',w:1.2,ep:8}, compelec:{name:'Componentes electronicos',w:.05,ep:2},
  equipo:{name:'Equipo / aparato',w:.80,ep:15}, auto:{name:'Automotriz y repuestos',w:.70,ep:10},
  calzado:{name:'Calzado',w:.60,ep:9}, bolsos:{name:'Bolsos y maletas',w:.60,ep:9},
  cocina:{name:'Cocina y utensilios',w:.50,ep:6}, oficina:{name:'Papeleria y oficina',w:.30,ep:4},
  ilum:{name:'Iluminacion / LED',w:.30,ep:6}, otro:{name:'Otros',w:.50,ep:6}
};
const KW = [
  [/(camis|ropa|dress|shirt|cloth|enteriz|legging|jean|hood|jacket|vestido|blusa)/,'textil'],
  [/(beauty|makeup|skin|cosm|belle|maquilla)/,'belleza'],
  [/(phone|case|funda|charger|cargador|cable|celular|airpod|earbud|audifono)/,'accel'],
  [/(watch|reloj|speaker|parlante|camera|camara|gadget|\btv\b)/,'electro'],
  [/(home|kitchen|hogar|cocina|organiz|decor)/,'hogar'],
  [/(gym|fitness|deporte|yoga|sport|mancuerna)/,'fitness'],
  [/(pet|mascota|\bdog\b|\bcat\b|perro|gato)/,'mascotas'],
  [/(toy|juguete|\bgame\b|juego)/,'juguetes'],
  [/(jewel|joya|bisuteria|ring|anillo|collar|necklace|arete)/,'joyeria'],
  [/(baby|bebe|infant|maternid)/,'bebes'],
  [/(tool|herramient|drill|taladro)/,'herram'],
  [/(shoe|calzado|sneaker|zapat|tenis)/,'calzado'],
  [/(bag|bolso|maleta|backpack|mochila)/,'bolsos'],
  [/(car|auto|repuesto|moto|vehic)/,'auto'],
  [/(led|lampar|ilumin|light)/,'ilum']
];
const SRC = [['alibaba','Alibaba'],['aliexpress','AliExpress'],['1688','1688'],['made-in-china','Made-in-China'],['amazon','Amazon'],['temu','Temu'],['shein','Shein'],['dhgate','DHgate'],['mercadolibre','MercadoLibre']];
const detectCat = t => { for (const [re,k] of KW) if (re.test(t)) return k; return 'otro'; };
const detectSrc = u => { for (const [s,n] of SRC) if (u.includes(s)) return n; return 'Proveedor'; };

function heuristic(url, catHint){
  const u = url.toLowerCase();
  const cat = (catHint && CATS[catHint]) ? catHint : detectCat(u);
  const src = detectSrc(u);
  return { name: src+' / '+CATS[cat].name, source: src, unitPriceUSD: CATS[cat].ep, weightKg: CATS[cat].w, category: cat, note: 'estimado (sin lectura directa del link)' };
}

function parsePrice($, html){
  // 1) JSON-LD offers.price
  try {
    let found = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      if (found) return;
      try {
        const j = JSON.parse($(el).contents().text());
        const arr = Array.isArray(j) ? j : [j];
        for (const o of arr){ const off = o.offers && (Array.isArray(o.offers)?o.offers[0]:o.offers); if (off && off.price){ found = parseFloat(off.price); } }
      } catch(e){}
    });
    if (found) return found;
  } catch(e){}
  // 2) meta tags
  const m = $('meta[property="product:price:amount"]').attr('content') || $('meta[property="og:price:amount"]').attr('content') || $('[itemprop="price"]').attr('content');
  if (m && !isNaN(parseFloat(m))) return parseFloat(m);
  // 3) regex de precio en el texto
  const rx = html.match(/(?:US\s?\$|\$|USD|¥|￥|CNY|RMB)\s?([0-9]+(?:[.,][0-9]{1,2})?)/i);
  if (rx) return parseFloat(rx[1].replace(',', '.'));
  return null;
}

app.get('/api/health', (_req, res) => res.json({ ok:true, service:'trendo-backend' }));

app.post('/api/analyze', async (req, res) => {
  const { url, qty } = req.body || {};
  if (!url) return res.status(400).json({ ok:false, error:'falta url' });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { signal: ctrl.signal, redirect:'follow', headers: {
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language':'es,en;q=0.8'
    }});
    clearTimeout(t);
    const html = await r.text();
    const $ = cheerio.load(html);
    const u = url.toLowerCase();
    const cat = detectCat((($('meta[property="og:title"]').attr('content')||$('title').text()||'') + ' ' + u).toLowerCase());
    const src = detectSrc(u);
    let name = ($('meta[property="og:title"]').attr('content') || $('title').text() || '').trim().replace(/\s+/g,' ').slice(0,80);
    let price = parsePrice($, html);
    // conversion de moneda aproximada
    const isRMB = /¥|￥|CNY|RMB|元/i.test(html) && !/US\s?\$|USD/i.test(html);
    if (price && isRMB) price = +(price / RMB_USD).toFixed(2);
    if (!price || price <= 0 || price > 5000) price = CATS[cat].ep; // descarta valores no confiables
    const data = {
      name: name || (src+' / '+CATS[cat].name),
      source: src,
      unitPriceUSD: price,
      weightKg: CATS[cat].w,
      category: cat,
      note: name && price ? 'lectura parcial del link (a confirmar)' : 'estimado'
    };
    return res.json({ ok:true, data });
  } catch (e) {
    // muchos marketplaces bloquean bots: devolvemos estimacion heuristica
    return res.json({ ok:true, data: heuristic(url), warning:'no se pudo leer el link directamente; estimacion heuristica' });
  }
});

let transporter = null;
function mailer(){
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: +(process.env.SMTP_PORT||465),
    secure: String(process.env.SMTP_SECURE||'true')==='true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return transporter;
}

app.post('/api/lead', async (req, res) => {
  const payload = req.body || {};
  const to = process.env.MAIL_TO || 'ceo@protipark.com';
  const ref = payload.ref || 'TR-IM';
  const cli = payload.cliente || {};
  const tot = payload.totales || {};
  const prods = (payload.productos||[]).map(p => `• ${p.nombre} — ${p.cantidad} uds @ US$${p.usd_unidad}/u (${p.categoria})${p.estimado?' [estimado '+p.fuente+']':''}`).join('<br>');
  const html = `
    <h2>Nueva cotizacion Trendo — ${ref}</h2>
    <p><b>Perfil:</b> ${payload.perfil||'-'}</p>
    <p><b>Cliente:</b> ${cli.nombre||'-'} · <b>WhatsApp:</b> ${cli.whatsapp||'-'} · <b>Email:</b> ${cli.email||'-'}<br>
       <b>Ciudad:</b> ${cli.ciudad||'-'} · <b>Empresa:</b> ${cli.empresa||'-'}</p>
    <p><b>Productos:</b><br>${prods||'-'}</p>
    <p><b>Envio:</b> ${(payload.envio||{}).modo} / ${(payload.envio||{}).regimen} · <b>Entrega:</b> ${(payload.envio||{}).entrega} · <b>TRM:</b> ${(payload.envio||{}).trm}</p>
    <p><b>Subtotal:</b> ${tot.subtotal_cop} · <b>Comision 7%:</b> ${tot.comision_protipark_7_cop} · <b>TOTAL:</b> ${tot.total_puesto_cop} · <b>/u:</b> ${tot.por_unidad_cop}</p>
    <p><b>Calificacion:</b> ${payload.calificacion||'-'} · <b>Comentario:</b> ${payload.comentario||'-'}</p>
    <hr><pre style="font-size:12px">${JSON.stringify(payload, null, 2)}</pre>`;
  try {
    await mailer().sendMail({
      from: process.env.MAIL_FROM || 'Trendo <no-reply@protipark.com>',
      to, subject: `Cotizacion Trendo ${ref} — ${cli.nombre||'cliente'}`,
      html, text: JSON.stringify(payload, null, 2)
    });
    return res.json({ ok:true, ref });
  } catch (e) {
    console.error('mail error', e.message);
    return res.status(500).json({ ok:false, error:'no se pudo enviar el correo', detail:e.message });
  }
});

app.listen(PORT, () => console.log('trendo-backend en puerto ' + PORT));
