# Trendo backend (powered by Protipark)

Servicio para el cotizador Trendo. Hace dos cosas:

1. **POST `/api/analyze`** `{ url, qty }` → intenta leer el link del producto (titulo, precio) y devuelve nombre, precio USD, peso y categoria estimados. Si el marketplace bloquea la lectura (Alibaba/AliExpress suelen hacerlo), responde una **estimacion heuristica** por dominio + palabras clave.
2. **POST `/api/lead`** `{ ...formulario }` → envia **todo el formulario en JSON** por correo a `ceo@protipark.com` cuando el cliente califica/finaliza.

> Nota honesta: leer precio/variantes/peso reales de Alibaba o AliExpress de forma 100% confiable requiere, ademas de este servidor, un proveedor anti-bot (proxies/render headless) o una API de sourcing de pago. Este backend deja el punto de integracion listo (`/api/analyze`); hoy hace lectura best-effort + estimacion. El correo de leads si funciona al 100% con un SMTP valido.

## 1. Probar en local
```bash
cd trendo-backend
cp .env.example .env     # edita SMTP_* y MAIL_TO
npm install
npm start                # queda en http://localhost:8080
```
Prueba: `http://localhost:8080/api/health` debe responder `{ "ok": true }`.

## 2. Variables de entorno (.env)
| Variable | Para que | Ejemplo |
|---|---|---|
| `MAIL_TO` | Destino de los leads | `ceo@protipark.com` |
| `MAIL_FROM` | Remitente visible | `Trendo <no-reply@protipark.com>` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | Servidor de correo saliente | `smtp.gmail.com` / `465` / `true` |
| `SMTP_USER` / `SMTP_PASS` | Usuario y clave SMTP | con Gmail usa un **App Password**, no tu clave normal |
| `ALLOW_ORIGIN` | Dominio del frontend (CORS) | `*` para probar, luego tu URL de GitHub Pages |

### Correo con Gmail (rapido)
1. Activa verificacion en 2 pasos en la cuenta.
2. Crea un **App Password** (Google Account → Security → App passwords).
3. Usa ese password de 16 caracteres en `SMTP_PASS`.
(Tambien sirve Zoho, Brevo, SendGrid, o el SMTP de tu hosting de protipark.com.)

## 3. Publicar gratis (Render, recomendado)
1. Sube esta carpeta `trendo-backend` a un repo de GitHub.
2. Entra a **render.com** → New → **Web Service** → conecta el repo.
3. Build command: `npm install` · Start command: `npm start`.
4. En **Environment** agrega las variables del paso 2.
5. Deploy. Render te da una URL tipo `https://trendo-backend.onrender.com`.
   - Verifica `https://trendo-backend.onrender.com/api/health`.

(Railway o Fly.io funcionan igual; cualquier host de Node 18+.)

## 4. Conectar el frontend
En `Trendo_Cotizador.html` / `index.html`, busca esta linea (cerca del inicio del `<script>`):
```js
var API_BASE='';
```
y ponle la URL de tu backend, por ejemplo:
```js
var API_BASE='https://trendo-backend.onrender.com';
```
Listo: con eso el modo "Tengo el link" consulta el backend y, al **calificar/finalizar**, llega el correo a `ceo@protipark.com` con todo el formulario en JSON.

Si dejas `API_BASE=''`, la app sigue funcionando (estimacion local, Excel y WhatsApp), solo no envia el correo automatico.

---

## 5. Validar que TODO funciona (pruebas)

Haz estas pruebas en orden. Cada una aisla un problema.

**Prueba 1 — el servidor vive**
Abre en el navegador: `https://trendo-46m6.onrender.com/api/health`
Debe responder algo como `{"ok":true,"service":"trendo-backend","scraper":false,"mailTo":"ceo@protipark.com"}`.
- Si tarda ~30–50s la primera vez: normal (plan free de Render "despierta").
- Si no abre: el servicio no esta desplegado o esta caido (revisa Render → Logs).

**Prueba 2 — el correo (la mas importante para tu caso)**
Abre: `https://trendo-46m6.onrender.com/api/test-mail`
- Si responde `{"ok":true,...}` → revisa la bandeja de `ceo@protipark.com` (y SPAM). El correo funciona.
- Si responde `{"ok":false,"error":"..."}` → ESE mensaje es la causa. Los típicos:
  - `Invalid login` / `Username and Password not accepted` → el `SMTP_PASS` no es un **App Password** (con Gmail hay que crear uno; la clave normal no sirve).
  - `self signed certificate` / puerto → revisa `SMTP_PORT=465` y `SMTP_SECURE=true`.
  - `Missing credentials` → faltan variables `SMTP_*` en Render.

**Prueba 3 — desde la página real**
Abre tu link de GitHub Pages, llena una cotización, califica y finaliza.
- En la última pantalla debe decir **"Cotizacion enviada a Trendo (correo OK)"**.
- Si dice "No se pudo enviar el correo": el backend respondió error → repite la Prueba 2 para ver el detalle, o mira Render → Logs (verás `LEAD recibido ...` y `lead mail ERROR ...`).

**Prueba 4 — lectura de link (si activaste SCRAPER_API_KEY)**
El backend ya recibe el POST de `/api/analyze`; en Render → Logs verás `analyze Alibaba imanes ...`.
Sin `SCRAPER_API_KEY` la lectura es heurística (estimada). Con la key, intenta render real.

### Por qué quizá no llegó el correo (causas más comunes)
1. Variables `SMTP_*` no están puestas en Render (solo en tu `.env` local no basta; hay que ponerlas en Render → Environment).
2. `SMTP_PASS` es la clave normal y no un App Password.
3. El correo llegó a **SPAM** (revisa esa carpeta).
4. El servicio estaba dormido y el primer intento se perdió (haz la Prueba 2 dos veces).

## 6. Sobre leer Alibaba "como lo hace el agente"
Leer precio/variantes/peso reales de Alibaba de forma confiable necesita renderizar JavaScript y saltar el anti-bot. Opciones, de menor a mayor fiabilidad:
- **ScraperAPI / ScrapingBee** (render=true): pones `SCRAPER_API_KEY` y el backend ya lo usa. Económico, pero a veces Alibaba bloquea igual.
- **API de datos de producto** (RapidAPI tiene "Alibaba/AliExpress product data"): devuelve JSON con precio, MOQ, specs. Lo más confiable; requiere adaptar `parsePrice` al formato de esa API.
- **Agente con navegador + IA** (como la demo): lo más potente y lo más caro de operar.
Dinos cuál prefieres y lo cableamos en `/api/analyze`.
