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
