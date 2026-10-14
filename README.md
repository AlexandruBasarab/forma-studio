# FORMĂ Studio

Configurator 3D de mobilier pentru explorarea culorilor, finisajelor și dimensiunilor, în limba română. Editorul și modelele salvate funcționează offline; generarea din fotografie folosește un AI extern printr-un server Cloudflare Worker sau Node.js.

## Funcționalități

- Două modele parametrice: dulap vitrină și bar cu masă extensibilă.
- Trei palete presetate și culori independente pentru blat, fronturi și carcasă.
- Finisaje lemn, mat și piatră.
- Dimensiuni editabile pentru corpuri și compartimentare.
- Lățime, adâncime și poziție independente pentru fiecare blat, inclusiv depășiri față de corp.
- Rotire 3D, zoom, vederi prestabilite, cote și deschiderea ușilor.
- Mod luminos / întunecat, cu preferința memorată în browser și detectarea temei sistemului la prima deschidere.
- Salvare automată în browser, export/import de proiecte JSON și export de imagini PNG.
- Partajarea configurației prin link: model, dimensiuni, blaturi, culori, finisaje și funcții.

În **Mobilier din fotografie**, utilizatorul încarcă o imagine, conectează OpenAI sau Google Gemini cu propria cheie API și apasă **Generează modelul 3D**. Modelul rezultat se deschide direct în configurator, cu culori, finisaje și dimensiuni editabile. Conversia locală din contur a fost înlocuită; proiectele vechi rămân compatibile.

AI-ul descrie piesele obiectului într-un format JSON validat, iar aplicația construiește geometria 3D din panouri și cilindri. Modelul este o interpretare aproximativă, mai potrivită pentru mobilier cu panouri, rafturi și picioare decât pentru forme organice. Dimensiunile deduse din fotografie trebuie verificate. Nu se execută cod generat de AI și nu se încarcă resurse externe indicate de acesta.

## Deschidere rapidă

Descarcă [configurator-mobilier.html](configurator-mobilier.html) și deschide-l într-un browser cu WebGL. Fișierul include codul, stilurile și biblioteca 3D; nu necesită instalare, backend sau conexiune la internet pentru vizualizare. Pentru a genera modele noi prin AI, folosește serverul local sau publicarea Cloudflare de mai jos; această funcție nu poate apela serverul dintr-o adresă `file://`.

## Dezvoltare

Este necesar Node.js 18 sau mai nou pentru comenzile de dezvoltare.

```sh
npm run build
npm start
```

Comanda de build generează `configurator-mobilier.html` și `dist/index.html`. Serverul local afișează în terminal adresa la care poate fi deschis configuratorul. Build-ul și serverul folosesc numai module Node.js incluse.

Pentru generare AI locală, copiază `.dev.vars.example` în `.dev.vars` și completează `AI_SESSION_SECRET` cu o valoare aleatoare de minimum 32 de caractere. Acesta este secretul de criptare a sesiunilor, **nu o cheie OpenAI sau Gemini**. De exemplu, poți genera o valoare local cu `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Nu distribui această valoare. Variabila poate fi setată și direct în mediul procesului. Repornește serverul după modificare.

Cheile personale ale furnizorilor se introduc doar în fereastra de conectare a aplicației. Nu le pune în surse, HTML, README, variabile de build sau Git. `.dev.vars`, `.env` și variantele lor sunt ignorate; câmpul pentru secret din fișierul exemplu este gol.

Editează fișierele din `src/`, apoi rulează din nou build-ul. Nu edita direct HTML-ul generat.

Comutatorul soare/lună din antet schimbă tema interfeței. Această preferință este separată de proiect și de linkurile partajate; culorile mobilierului rămân cele alese în configurator. Fundalul exportului PNG urmează tema curentă.

## Publicare

### Cloudflare Workers cu generare AI

Configurația `wrangler.jsonc` publică un Worker separat, **forma-studio-ai**, cu fișierele din `dist` și endpointurile `/api/ai/*`. Pentru branch-ul acestei funcții, selectează `codex/external-ai-furniture` în integrarea Git Cloudflare:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: rădăcina repository-ului
- Variables and Secrets: adaugă `AI_SESSION_SECRET` ca **Secret**, cu o valoare aleatoare de minimum 32 de caractere, diferită de cea locală.

Poți adăuga secretul și din terminal cu `npx wrangler secret put AI_SESSION_SECRET`; valoarea se introduce interactiv. Nu adăuga cheile personale ale furnizorilor în setările publice de build. Generarea rămâne indisponibilă până când secretul de sesiune este configurat. Deploy-ul necesită autentificare Cloudflare și o versiune Node acceptată de Wrangler; folosește Node.js 22 sau mai nou pentru deploy.

Acest branch nu modifică automat Worker-ul de producție `forma-studio`. Pentru un preview din dashboard, păstrează numele separat și configurează secretul și în mediul respectiv. Git push publică sursele; deploy-ul este un pas distinct.

### Găzduire statică

Poți încărca numai `dist` pe orice serviciu static (inclusiv Netlify, folosind configurația existentă). Editorul 3D, salvarea, partajarea și modelele deja generate funcționează, dar generarea AI necesită backendul inclus. Nu există un fallback local de conversie.

## Conectarea AI și confidențialitate

- OpenAI: [creează o cheie API](https://platform.openai.com/api-keys). Facturarea API este [separată de abonamentul ChatGPT](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform).
- Gemini: [creează o cheie în Google AI Studio](https://aistudio.google.com/apikey). Se aplică disponibilitatea, limitele și tarifele contului API.
- Conectarea verifică cheia la furnizor fără a genera un model. Cheia ajunge prin HTTPS la serverul site-ului și apoi la furnizor. Folosește această funcție numai pe o instanță de încredere.
- Sesiunea este păstrată cel mult o oră într-un cookie criptat AES-GCM, `HttpOnly`, `SameSite=Strict` și `Secure` pe HTTPS. Cheia nu apare în localStorage, URL, exporturi JSON sau HTML. Nu există chei de furnizor comune ori baze de date cu chei. Deconectarea șterge cookie-ul.
- Fotografia este redimensionată și recodificată în JPEG (maximum 1536 px pe latura mare), fără metadatele fișierului original. Este trimisă AI-ului numai la apăsarea butonului de generare. Aplicația cere `store:false` furnizorilor; politicile lor de procesare/retenție rămân aplicabile.
- Fotografia redusă pentru previzualizare și descriptorul 3D sunt salvate local în proiect; cererile și cheile nu sunt jurnalizate de aplicație. Dacă adaugi servicii de monitorizare proprii, nu înregistra body-uri, cookie-uri sau antete de autentificare.
- Închiderea ferestrei anulează așteptarea în browser, dar nu garantează anularea procesării sau facturării la furnizor. Nu există reluări automate ale generării.

**De ce nu există un buton de autentificare directă cu ChatGPT?** Integrarea [Sign in with ChatGPT pentru website-uri](https://developers.openai.com/siwc/website) necesită [înregistrare și acces acordat de OpenAI](https://developers.openai.com/siwc/request-client-id). Nu este simulată o autentificare OAuth. Versiunea curentă folosește conectarea prin API, disponibilă fără această aprobare.

## Partajarea configurației

În secțiunea **Partajare**, apasă **Partajează configurația**. Linkul conține parametrul `config`, cu un obiect JSON codificat Base64url:

```json
{
  "v": 1,
  "model": "custom",
  "top": "#c5a277",
  "topFinish": "wood",
  "fronts": "#87927b",
  "frontsFinish": "matte",
  "body": "#eff0e7",
  "bodyFinish": "matte",
  "sizes": {
    "custom": {
      "width": 200, "depth": 50, "height": 215,
      "counterHeight": 90, "upperDepth": 30, "nicheHeight": 47.5
    },
    "bar": {
      "width": 80, "depth": 90, "height": 110,
      "tableLength": 110, "tableDepth": 90, "tableHeight": 76
    }
  },
  "worktops": {
    "cabinet": {"widthDelta": 0, "depthDelta": 0, "offsetX": 0, "offsetZ": 0},
    "bar": {"widthDelta": 0, "depthDelta": 0, "offsetX": 0, "offsetZ": 0},
    "table": {"widthDelta": 0, "depthDelta": 0, "offsetX": 0, "offsetZ": 0}
  },
  "extension": 1,
  "glass": true,
  "doorsOpen": false,
  "dimensions": false
}
```

La deschidere, linkul restabilește modelul selectat (`custom` sau `bar`), dimensiunile ambelor modele, cele trei blaturi și opțiunile de afișare, împreună cu toate culorile și finisajele. Dimensiunile și deplasările sunt în centimetri. `widthDelta` și `depthDelta` reprezintă ajustările față de dimensiunea implicită a blatului, astfel încât depășirile se păstrează când corpul sau extensia mesei se modifică. `offsetX` mută blatul spre dreapta pentru valori pozitive, iar `offsetZ` spre față. `extension` este între `0` (retrasă) și `1` (extinsă).

Parametrii invalizi sunt respinși. După partajare, modificările configurației actualizează și adresa paginii. Linkurile vechi cu parametrul `finisaje` rămân compatibile și aplică numai cele șase câmpuri de culori și finisaje, păstrând modelul și dimensiunile destinatarului.

Partajarea prin link este disponibilă pentru cele două modele predefinite. Pentru un model generat din fotografie, folosește **Salvează proiectul** și importul fișierului JSON: acesta conține geometria, miniatura, culorile, finisajele și dimensiunile, fără credențiale AI. Destinatarul poate deschide și edita proiectul fără conectare la AI.

Pentru a trimite linkul altor persoane, generează-l din versiunea publicată pe web. Un link `file://` indică un fișier de pe calculatorul local.

## Verificare

```sh
npm install
npx playwright install chromium
npm test
```

Testele verifică modelele, dimensiunile, blaturile, salvarea proiectelor, linkurile de partajare, funcționarea offline și afișarea pe mobil. Capturile și proiectele de test sunt generate în `qa/`, folder exclus din Git. Opțional, variabila `PLAYWRIGHT_CHANNEL=msedge` selectează un Microsoft Edge instalat local.

`npm run test:photo` reconstruiește aplicația și rulează verificările pentru AI: schema, geometria, sesiunile, adaptoarele de furnizori, erorile și interfața. Răspunsurile furnizorilor sunt simulate controlat în teste: nu sunt necesare chei reale și nu se fac apeluri plătite. Aceste verificări nu măsoară fidelitatea reconstrucției unui model real; aceasta trebuie evaluată separat cu propriul cont API.

## Structură

| Cale | Conținut |
| --- | --- |
| `src/` | Interfață, logică, modele 3D și stiluri |
| `src/ai-schema.js` | Contract JSON strict, comun browserului și serverului |
| `server/` | Sesiuni criptate, adaptoare OpenAI/Gemini și Worker Cloudflare |
| `wrangler.jsonc` | Publicarea Worker-ului AI și a fișierelor statice |
| `vendor/` | Three.js inclus local și licența aferentă |
| `build.cjs` | Generarea HTML-ului autonom și a folderului de publicare |
| `serve.cjs` | Server HTTP local |
| `qa*.cjs` | Verificări automate în browser |
| `configurator-mobilier.html` | Aplicația completă, gata de deschis |

Modelele sunt interpretări orientative ale schițelor de referință, nu documentație tehnică de execuție. Three.js este distribuit conform [licenței MIT incluse](vendor/THREE-LICENSE.txt).
