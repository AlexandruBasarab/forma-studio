# FORMĂ Studio

Configurator 3D de mobilier pentru explorarea culorilor, finisajelor și dimensiunilor. Aplicație statică, în limba română, care funcționează în browser, inclusiv offline.

## Funcționalități

- Două modele parametrice: dulap vitrină și bar cu masă extensibilă.
- Trei palete presetate și culori independente pentru blat, fronturi și carcasă.
- Finisaje lemn, mat și piatră.
- Dimensiuni editabile pentru corpuri și compartimentare.
- Lățime, adâncime și poziție independente pentru fiecare blat, inclusiv depășiri față de corp.
- Rotire 3D, zoom, vederi prestabilite, cote și deschiderea ușilor.
- Salvare automată în browser, export/import de proiecte JSON și export de imagini PNG.
- Partajarea configurației prin link: model, dimensiuni, blaturi, culori, finisaje și funcții.

Generarea unui model din fotografie este ascunsă temporar. Codul acestei funcții rămâne în proiect pentru o eventuală reactivare.

## Deschidere rapidă

Descarcă [configurator-mobilier.html](configurator-mobilier.html) și deschide-l într-un browser cu WebGL. Fișierul include codul, stilurile și biblioteca 3D; nu necesită instalare, backend sau conexiune la internet pentru vizualizare.

## Dezvoltare

Este necesar Node.js 18 sau mai nou pentru comenzile de dezvoltare.

```sh
npm run build
npm start
```

Comanda de build generează `configurator-mobilier.html` și `dist/index.html`. Serverul local afișează în terminal adresa la care poate fi deschis configuratorul. Build-ul și serverul folosesc numai module Node.js incluse.

Editează fișierele din `src/`, apoi rulează din nou build-ul. Nu edita direct HTML-ul generat.

## Publicare

Rulează `npm run build`, apoi încarcă folderul `dist` pe un serviciu de găzduire statică. Pentru Netlify, configurația din `netlify.toml` folosește automat comanda de build și folderul `dist`.

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

Partajarea prin link este disponibilă pentru cele două modele parametrice. Pentru un model creat anterior din fotografie, folosește exportul și importul proiectului JSON.

Pentru a trimite linkul altor persoane, generează-l din versiunea publicată pe web. Un link `file://` indică un fișier de pe calculatorul local.

## Verificare

```sh
npm install
npx playwright install chromium
npm test
```

Testele verifică modelele, dimensiunile, blaturile, salvarea proiectelor, linkurile de partajare, funcționarea offline și afișarea pe mobil. Capturile și proiectele de test sunt generate în `qa/`, folder exclus din Git. Opțional, variabila `PLAYWRIGHT_CHANNEL=msedge` selectează un Microsoft Edge instalat local.

`npm run test:photo` este suita opțională pentru importul din fotografie; este omisă automat cât timp funcția este dezactivată.

## Structură

| Cale | Conținut |
| --- | --- |
| `src/` | Interfață, logică, modele 3D și stiluri |
| `vendor/` | Three.js inclus local și licența aferentă |
| `build.cjs` | Generarea HTML-ului autonom și a folderului de publicare |
| `serve.cjs` | Server HTTP local |
| `qa*.cjs` | Verificări automate în browser |
| `configurator-mobilier.html` | Aplicația completă, gata de deschis |

Modelele sunt interpretări orientative ale schițelor de referință, nu documentație tehnică de execuție. Three.js este distribuit conform [licenței MIT incluse](vendor/THREE-LICENSE.txt).
