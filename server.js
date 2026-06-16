// Trendo backend (powered by Protipark)
//  GET  /api/health      -> ping
//  GET  /api/test-mail   -> envia un correo de prueba a MAIL_TO (para validar SMTP desde el navegador)
//  POST /api/analyze     -> lee el link del producto (con scraping render si hay SCRAPER_API_KEY) y estima
//  POST /api/lead        -> envia el formulario completo (JSON) por correo a ceo@protipark.com
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: process.env.ALLOW_ORIGIN || '*' }));

const PORT = process.env.PORT || 8080;
const MAIL_TO = process.env.MAIL_TO || 'ceo@protipark.com';
const RMB_USD = 7.15;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

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
  ilum:{name:'Iluminacion / LED',w:.30,ep:6}, imanes:{name:'Imanes / industriales',w:.05,ep:.5}, otro:{name:'Otros',w:.50,ep:6}
};
const KW = [
  [/(magnet|iman|neodym|ndfeb)/,'imanes'],
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
const heuristic = (url, catHint) => {
  const u = url.toLowerCase();
  const cat = (catHint && CATS[catHint]) ? catHint : detectCat(u);
  const src = detectSrc(u);
  return { name: src+' / '+CATS[cat].name, source: src, unitPriceUSD: CATS[cat].ep, weightKg: CATS[cat].w, category: cat, note: 'estimacion heuristica (no se pudo leer el link)' };
};

async function fetchHtml(url){
  const key = process.env.SCRAPER_API_KEY;
  const target = key
    ? 'https://api.scraperapi.com/?api_key='+key+'&render=true&country_code=us&url='+encodeURIComponent(url)
    : url;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), key ? 65000 : 9000);
  try {
    const r = await fetch(target, { signal: ctrl.signal, redirect:'follow', headers:{ 'User-Agent':UA, 'Accept-Language':'es,en;q=0.8' } });
    const html = await r.text();
    return { status:r.status, html, rendered: !!key };
  } finally { clearTimeout(t); }
}
function parsePrice($, html){
  try {
    let found=null;
    $('script[type="application/ld+json"]').each((_,el)=>{ if(found)return;
      try{ const j=JSON.parse($(el).contents().text()); const arr=Array.isArray(j)?j:[j];
        for(const o of arr){ const off=o.offers&&(Array.isArray(o.offers)?o.offers[0]:o.offers);
          if(off){ if(off.price) found=parseFloat(off.price); else if(off.lowPrice) found=parseFloat(off.lowPrice); } } }catch(e){} });
    if(found) return found;
  } catch(e){}
  const m=$('meta[property="product:price:amount"]').attr('content')||$('meta[property="og:price:amount"]').attr('content')||$('[itemprop="price"]').attr('content');
  if(m && !isNaN(parseFloat(m))) return parseFloat(m);
  const rx=html.match(/(?:US\s?\$|\$|USD|¥|￥|CNY|RMB)\s?([0-9]+(?:[.,][0-9]{1,2})?)/i);
  if(rx) return parseFloat(rx[1].replace(',','.'));
  return null;
}

app.get('/api/health', (_q,res)=> res.json({ ok:true, service:'trendo-backend', emailVia: process.env.RESEND_API_KEY?'resend':'smtp', scraper: !!process.env.SCRAPER_API_KEY, mailTo: MAIL_TO }));

app.get('/api/test-mail', async (_q,res)=>{
  try{
    const info = await sendEmail({ subject:'Prueba de correo Trendo (OK)',
      text:'Si lees esto, el correo del cotizador Trendo funciona.',
      html:'<b>Funciona</b> el correo del cotizador Trendo. (prueba)' });
    console.log('test-mail enviado', info.via, info.messageId);
    res.json({ ok:true, sentTo: MAIL_TO, via: info.via, messageId: info.messageId });
  }catch(e){ console.error('test-mail ERROR', e.message); res.status(500).json({ ok:false, error:e.message }); }
});

// extrae source + id de producto del URL (Alibaba .../_1601455645588.html, AliExpress /item/100500xxx.html, etc.)
function extractInfo(url){
  const source = detectSrc(url.toLowerCase());
  let id=null, m = url.match(/(\d{8,})\.html/) || url.match(/\/(\d{8,})(?:[\/?\.]|$)/) || url.match(/[?&](?:id|itemId|productId)=(\d{6,})/i);
  if(m) id=m[1];
  return { source, id };
}
// escaner profundo: busca precio/titulo/peso/moq en cualquier JSON sin depender del formato del proveedor
function deepScan(obj){
  const out={prices:[],titles:[],weights:[],moqs:[],currency:null}, seen=new Set();
  (function walk(o){
    if(!o||typeof o!=='object'||seen.has(o))return; seen.add(o);
    for(const k in o){ const v=o[k], key=k.toLowerCase();
      if(v&&typeof v==='object'){ walk(v); continue; }
      const isP=/(price|saleprice|app_sale_price|target_sale_price|min_?price|amount)/.test(key);
      const isW=/(weight|gross_?weight|package_?weight)/.test(key);
      const isM=/(moq|min_?order|min_?quantity)/.test(key);
      if(typeof v==='number'){
        if(isP&&v>0&&v<100000)out.prices.push(v);
        if(isW&&v>0&&v<100000)out.weights.push(v);
        if(isM&&v>0)out.moqs.push(v);
      } else if(typeof v==='string'){
        if(isP){ const m=v.replace(/,/g,'').match(/\d+(?:\.\d+)?/); if(m){const n=parseFloat(m[0]); if(n>0&&n<100000)out.prices.push(n);} }
        else if(isW){ const m=v.match(/\d+(?:\.\d+)?/); if(m){const n=parseFloat(m[0]); if(n>0&&n<100000)out.weights.push(n);} }
        else if(isM){ const m=v.match(/\d+/); if(m)out.moqs.push(parseInt(m[0],10)); }
        else if(/(title|subject|product_?name|^name$)/.test(key)&&v.length>8&&v.length<200&&out.titles.length<5)out.titles.push(v);
        if(/currency/.test(key)&&/^[A-Z]{3}$/.test(v)&&!out.currency)out.currency=v;
      }
    }
  })(obj);
  return out;
}
// rellena el contrato completo con defaults
function pack(o){
  return Object.assign({ url:null,source:'Proveedor',productId:null,name:null,description:null,images:[],currency:'USD',
    priceMin:null,priceMax:null,unitPriceUSD:null,minimumOrderQuantity:null,unit:'piece',variants:[],
    supplier:{name:null,verified:null,years:null,country:'China'},shipping:{available:true,estimatedCostUSD:null},
    weightKg:null,category:'otro',confidence:0,method:'estimate',note:'' }, o);
}
// API estructurada (RapidAPI) configurable por env (pones la URL con {id})
async function tryRapidApi(url, source, id){
  const key=process.env.RAPIDAPI_KEY; if(!key||!id) return null;
  let tpl = /aliexpress/i.test(source)?process.env.RAPIDAPI_ALIEXPRESS_URL : /alibaba/i.test(source)?process.env.RAPIDAPI_ALIBABA_URL : (process.env.RAPIDAPI_ALIEXPRESS_URL||process.env.RAPIDAPI_ALIBABA_URL);
  if(!tpl) return null;
  const apiUrl=tpl.replace('{id}',encodeURIComponent(id)), host=new URL(apiUrl).host;
  const ctrl=new AbortController(), t=setTimeout(()=>ctrl.abort(),15000);
  try{
    const r=await fetch(apiUrl,{signal:ctrl.signal,headers:{'X-RapidAPI-Key':key,'X-RapidAPI-Host':host}});
    const txt=await r.text(); let j;
    try{ j=JSON.parse(txt); }catch(e){ return {_error:'respuesta no-JSON', status:r.status, sample:txt.slice(0,400), host}; }
    const sc=deepScan(j);
    if(!sc.prices.length&&!sc.titles.length) return {_empty:true, status:r.status, sample:JSON.stringify(j).slice(0,500), host};
    let pmin=sc.prices.length?Math.min(...sc.prices):null, pmax=sc.prices.length?Math.max(...sc.prices):null;
    if(sc.currency&&/CNY|RMB/i.test(sc.currency)){ if(pmin)pmin=+(pmin/RMB_USD).toFixed(2); if(pmax)pmax=+(pmax/RMB_USD).toFixed(2); }
    return {name:sc.titles[0]||null,priceMin:pmin,priceMax:pmax,price:pmin,weightKg:sc.weights[0]||null,moq:sc.moqs.length?Math.min(...sc.moqs):null,currency:sc.currency||'USD',status:r.status,host};
  }catch(e){ return {_error:e.message,host}; } finally{ clearTimeout(t); }
}

async function analyzeCore(url){
  const { source, id } = extractInfo(url);
  const u=url.toLowerCase(); const debug={ id, source, layers:[] };
  try{
    const api=await tryRapidApi(url,source,id);
    if(api){ debug.layers.push({rapidapi:{found:!!(api.name||api.price),error:api._error,empty:api._empty,status:api.status,host:api.host,sample:api.sample}});
      if(api.name||api.price){
        const cat=detectCat(((api.name||'')+' '+u).toLowerCase());
        return { ok:true, method:'api', data: pack({ url, source, productId:id,
          name:(api.name||source+' / '+CATS[cat].name).slice(0,90), currency:api.currency||'USD',
          priceMin:api.priceMin, priceMax:api.priceMax, unitPriceUSD:(api.price>0?+api.price.toFixed(2):CATS[cat].ep),
          minimumOrderQuantity:api.moq||null, weightKg:(api.weightKg>0?api.weightKg:CATS[cat].w), category:cat,
          confidence:(api.price&&api.name?0.85:0.6), method:'api',
          note:'lectura via API de producto'+(api.weightKg>0?'':' (peso estimado por categoria)') }), debug };
      }
    } else debug.layers.push({rapidapi:'sin-config'});
  }catch(e){ debug.layers.push({rapidapi_err:e.message}); }
  try{
    const { status, html, rendered } = await fetchHtml(url);
    const $=cheerio.load(html);
    const title=($('meta[property="og:title"]').attr('content')||$('title').text()||'').trim().replace(/\s+/g,' ');
    let price=parsePrice($,html);
    if(!price){ const blobs=html.match(/\{[^<]{200,}\}/g)||[]; for(const bl of blobs.slice(0,40)){ try{ const sc=deepScan(JSON.parse(bl)); if(sc.prices.length){ price=Math.min(...sc.prices); break; } }catch(e){} } }
    const isRMB=/¥|￥|CNY|RMB|元/i.test(html)&&!/US\s?\$|USD/i.test(html); if(price&&isRMB)price=+(price/RMB_USD).toFixed(2);
    const blocked=/captcha|verify|robot|punish|slide to verify|unusual traffic/i.test(html)||status>=400;
    const cat=detectCat((title+' '+u).toLowerCase());
    debug.layers.push({scraper:{rendered,status,blocked,gotTitle:!!title,gotPrice:!!price}});
    const had=!!price; if(!price||price<=0||price>5000)price=CATS[cat].ep;
    return { ok:true, method:'scraper', data: pack({ url, source, productId:id,
      name:title?title.slice(0,90):(source+' / '+CATS[cat].name), unitPriceUSD:price,
      priceMin:had?price:null, priceMax:had?price:null, weightKg:CATS[cat].w, category:cat,
      confidence: blocked?0.3:(had?0.6:0.4), method:'scraper',
      note: blocked?'el sitio bloqueo la lectura; estimacion':(rendered?'lectura renderizada (a confirmar)':'lectura parcial (a confirmar)') }), debug };
  }catch(e){
    debug.layers.push({scraper_err:e.message});
    const h=heuristic(url);
    return { ok:true, method:'estimate', warning:'Informacion estimada; requiere confirmacion',
      data: pack({ url, source, productId:id, name:h.name, unitPriceUSD:h.unitPriceUSD, priceMin:h.unitPriceUSD, priceMax:h.unitPriceUSD,
        weightKg:h.weightKg, category:h.category, confidence:0.25, method:'estimate', note:h.note }), debug };
  }
}
app.post('/api/analyze', async (req,res)=>{ const { url }=req.body||{}; if(!url) return res.status(400).json({ ok:false, error:'falta url' }); res.json(await analyzeCore(url)); });
app.get('/api/analyze-test', async (req,res)=>{ const url=req.query.url; if(!url) return res.status(400).json({ ok:false, error:'falta ?url= (pega el link codificado)' }); res.json(await analyzeCore(url)); });

let transporter=null;
function mailer(){
  if(transporter) return transporter;
  const secure = String(process.env.SMTP_SECURE||'true')==='true';
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST, port:+(process.env.SMTP_PORT||465), secure,
    auth:{ user:process.env.SMTP_USER, pass:process.env.SMTP_PASS },
    connectionTimeout: 15000, greetingTimeout: 10000, socketTimeout: 20000,
    ...(secure ? {} : { requireTLS:true })
  });
  return transporter;
}
// Envia por Resend (HTTP, puerto 443: nunca lo bloquean) si hay RESEND_API_KEY; si no, por SMTP.
async function sendEmail({subject, html, text}){
  const from = process.env.MAIL_FROM || 'Trendo <onboarding@resend.dev>';
  if(process.env.RESEND_API_KEY){
    const r = await fetch('https://api.resend.com/emails', { method:'POST',
      headers:{ 'Authorization':'Bearer '+process.env.RESEND_API_KEY, 'Content-Type':'application/json' },
      body: JSON.stringify({ from, to:[MAIL_TO], subject, html, text }) });
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error('Resend '+r.status+': '+(j.message||JSON.stringify(j)));
    return { messageId:j.id, via:'resend' };
  }
  const info = await mailer().sendMail({ from, to:MAIL_TO, subject, html, text });
  return { messageId:info.messageId, via:'smtp' };
}

app.post('/api/lead', async (req,res)=>{
  const p = req.body || {};
  console.log('LEAD recibido', p.ref, (p.cliente||{}).nombre);  // queda en los logs de Render aunque el correo falle
  const cli=p.cliente||{}, tot=p.totales||{}, env=p.envio||{};
  const prods=(p.productos||[]).map(x=>`• ${x.nombre} — ${x.cantidad} uds @ US$${x.usd_unidad}/u (${x.categoria})${x.estimado?' [estimado '+x.fuente+']':''}`).join('<br>');
  const html=`<h2>Nueva cotizacion Trendo — ${p.ref||''}</h2>
    <p><b>Perfil:</b> ${p.perfil||'-'}</p>
    <p><b>Cliente:</b> ${cli.nombre||'-'} · <b>WhatsApp:</b> ${cli.whatsapp||'-'} · <b>Email:</b> ${cli.email||'-'}<br>
       <b>Ciudad:</b> ${cli.ciudad||'-'} · <b>Empresa:</b> ${cli.empresa||'-'}</p>
    <p><b>Productos:</b><br>${prods||'-'}</p>
    <p><b>Envio:</b> ${env.modo} / ${env.regimen} · <b>Entrega:</b> ${env.entrega} · <b>TRM:</b> ${env.trm}</p>
    <p><b>Subtotal:</b> ${tot.subtotal_cop} · <b>Comision 7%:</b> ${tot.comision_protipark_7_cop} · <b>TOTAL:</b> ${tot.total_puesto_cop} · <b>/u:</b> ${tot.por_unidad_cop}</p>
    <p><b>Calificacion:</b> ${p.calificacion||'-'} · <b>Comentario:</b> ${p.comentario||'-'}</p>
    <hr><pre style="font-size:12px">${JSON.stringify(p,null,2)}</pre>`;
  try{
    const info=await sendEmail({ subject:`Cotizacion Trendo ${p.ref||''} - ${cli.nombre||'cliente'}`, html, text: JSON.stringify(p,null,2) });
    res.json({ ok:true, ref:p.ref, via: info.via, messageId: info.messageId });
  }catch(e){ console.error('lead mail ERROR', e.message); res.status(500).json({ ok:false, error:e.message }); }
});

app.listen(PORT, ()=>{
  console.log('trendo-backend en puerto '+PORT+' | scraper:'+(!!process.env.SCRAPER_API_KEY)+' | mailTo:'+MAIL_TO);
  if(process.env.RESEND_API_KEY){ console.log('Email via Resend (HTTP) - OK'); }
  else { try{ mailer().verify().then(()=>console.log('SMTP OK: listo para enviar')).catch(e=>console.error('SMTP NO conecta:', e.message)); }catch(e){ console.error('SMTP config faltante:', e.message); } }
});
