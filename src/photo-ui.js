/* External AI generation. Credentials never enter furniture/project state. */
(function () {
  'use strict';
  const PROVIDERS = {
    openai: {name: 'OpenAI', link: 'https://platform.openai.com/api-keys', note: 'Folosește modelele OpenAI prin API. Abonamentul ChatGPT nu include credit API; conectarea directă cu ChatGPT necesită o integrare aprobată de OpenAI.'},
    gemini: {name: 'Google Gemini', link: 'https://aistudio.google.com/apikey', note: 'Folosește o cheie din Google AI Studio. Disponibilitatea și costurile depind de contul tău Gemini API.'}
  };
  const byId = id => document.getElementById(id);
  let api, el, imageData = null, thumbnail = null, revision = 0, controller = null;
  let busy = false, session = {configured: false, connected: false};
  function status(message, kind = 'info') { el.status.textContent = message; el.status.dataset.kind = kind; }
  function render() {
    const selected = el.provider.value, provider = PROVIDERS[selected];
    const connected = session.connected && session.provider === selected;
    el.dialog.setAttribute('aria-busy', String(busy));
    el.generate.disabled = busy || !imageData || !connected;
    el.connect.disabled = busy || !session.configured || !el.key.value.trim();
    el.disconnect.disabled = busy; el.disconnect.hidden = !session.connected;
    el.choose.disabled = busy; el.provider.disabled = busy; el.key.disabled = busy || !session.configured;
    el.connection.textContent = session.connected ? 'Conectat la ' + PROVIDERS[session.provider].name + ' · sesiune de maximum o oră' : 'Niciun cont AI conectat';
    el.connection.dataset.connected = String(session.connected);
    el.keyRow.hidden = connected;
    el.providerNote.textContent = provider.note;
    el.keyLink.href = provider.link; el.keyLink.textContent = 'Obține o cheie ' + provider.name + ' ↗';
    el.connect.textContent = 'Conectează ' + provider.name;
    el.generate.textContent = busy ? 'Se procesează…' : 'Generează modelul 3D →';
  }
  function interrupt() {
    revision++; if (controller) controller.abort();
    controller = null; busy = false; el.key.value = ''; render();
  }
  async function request(path, body, signal) {
    const response = await fetch('/api/ai/' + path, {
      method: body === undefined ? 'GET' : 'POST', headers: body === undefined ? {} : {'Content-Type': 'application/json'},
      credentials: 'same-origin', cache: 'no-store', signal,
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Serviciul AI nu este disponibil pe această adresă. Publică versiunea cu serverul Cloudflare sau pornește serverul local.'); }
    if (!response.ok) {
      if (response.status === 401) session = {...session, connected: false};
      throw new Error(typeof result.error?.message === 'string' ? result.error.message : 'Cererea AI nu a reușit. Încearcă din nou.');
    }
    return result;
  }
  async function action(work) {
    if (busy) return;
    const token = ++revision, active = new AbortController();
    controller = active; busy = true; render();
    const timer = setTimeout(() => active.abort(), 150000);
    try { await work(active.signal, token); }
    catch (error) {
      if (token !== revision || !el.dialog.open) return;
      status(error.name === 'AbortError' ? 'Timpul de așteptare a expirat. Verifică serviciul AI înainte de a relua; cererea poate fi deja procesată.' : error instanceof TypeError ? 'Conexiunea la server nu a reușit. Verifică internetul și încearcă din nou.' : error.message, 'error');
    } finally {
      clearTimeout(timer);
      if (token === revision) { busy = false; controller = null; render(); }
    }
  }
  async function open() {
    if (el.dialog.open) return;
    el.dialog.showModal();
    if (location.protocol === 'file:') {
      session = {configured: false, connected: false}; render();
      status('Generarea AI necesită un server. Deschide site-ul publicat cu Worker-ul Cloudflare sau folosește adresa afișată de npm start. Modelele salvate pot fi vizualizate și offline.', 'error'); return;
    }
    await action(async (signal, token) => {
      status('Verificăm conexiunea AI…');
      const result = await request('session', undefined, signal);
      if (token !== revision) return;
      session = {configured: result.configured === true, connected: result.connected === true && Object.hasOwn(PROVIDERS, result.provider), provider: result.provider};
      if (session.connected) el.provider.value = session.provider;
      status(!session.configured ? (result.message || 'Serverul AI nu este configurat. Administratorul trebuie să adauge secretul de sesiune.') : session.connected ? 'Conexiunea AI este activă. Alege fotografia și generează modelul.' : 'Alege fotografia și conectează furnizorul AI.', session.configured ? 'info' : 'error');
    });
  }
  async function loadFile(file) {
    if (!file || busy) return;
    imageData = thumbnail = null; el.preview.removeAttribute('src'); el.preview.hidden = true; el.empty.hidden = false;
    el.fileName.textContent = 'Nicio fotografie selectată'; render();
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 12 * 1024 * 1024) {
      status('Alege o imagine PNG, JPG sau WEBP de cel mult 12 MB.', 'error'); return;
    }
    await action(async (_signal, token) => {
      status('Pregătim fotografia…');
      const url = URL.createObjectURL(file);
      try {
        const source = new Image(); source.src = url; await source.decode();
        if (token !== revision) return;
        if (source.naturalWidth * source.naturalHeight > 30000000) throw new Error('Imaginea este prea mare. Folosește cel mult 30 megapixeli.');
        const resizedShortest = Math.round(Math.min(source.naturalWidth, source.naturalHeight) * Math.min(1, 1536 / Math.max(source.naturalWidth, source.naturalHeight)));
        if (resizedShortest < 32) throw new Error('Imaginea este prea îngustă sau prea mică. Folosește minimum 32 pixeli pe fiecare latură după redimensionarea la 1536 px.');
        function resize(edge, quality) {
          const scale = Math.min(1, edge / Math.max(source.naturalWidth, source.naturalHeight));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(source.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
          const ctx = canvas.getContext('2d'); if (!ctx) throw new Error('Browserul nu poate pregăti fotografia.');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL('image/jpeg', quality);
        }
        // Re-encoding strips source metadata; only this resized image is sent.
        imageData = resize(1536, 0.85); thumbnail = resize(320, 0.65);
        el.preview.src = imageData; el.preview.hidden = false; el.empty.hidden = true; el.fileName.textContent = file.name.slice(0, 120);
        status('Fotografia este pregătită. Va fi trimisă furnizorului ales doar când apeși „Generează modelul 3D”.');
      } catch (error) {
        if (error.name === 'EncodingError') throw new Error('Fișierul nu poate fi citit ca imagine. Alege o altă fotografie.');
        throw error;
      } finally { URL.revokeObjectURL(url); }
    });
  }
  async function connect() {
    if (!el.key.value.trim() || busy) return;
    const provider = el.provider.value, apiKey = el.key.value.trim(); el.key.value = '';
    await action(async (signal, token) => {
      status('Verificăm cheia la ' + PROVIDERS[provider].name + '…');
      const result = await request('connect', {provider, apiKey}, signal);
      if (token !== revision) return;
      if (result.connected !== true || result.provider !== provider) throw new Error('Conexiunea nu a putut fi confirmată.');
      session = {configured: true, connected: true, provider}; status('Conectat. Poți genera modelul folosind fotografia aleasă.', 'success');
    });
  }
  async function disconnect() {
    await action(async (signal, token) => {
      await request('disconnect', {}, signal); if (token !== revision) return;
      session = {...session, connected: false}; el.key.value = ''; status('Conexiunea AI a fost închisă. Modelele deja generate rămân disponibile.');
    });
  }
  async function generate() {
    if (!imageData || !session.connected || session.provider !== el.provider.value || busy) return;
    await action(async (signal, token) => {
      status('AI-ul analizează fotografia și construiește piesele 3D. Poate dura până la două minute.');
      const result = await request('generate', {image: imageData}, signal); if (token !== revision) return;
      const descriptor = window.FurnitureAI.validateDescriptor(result.descriptor);
      if (descriptor.kind !== 'furniture') throw new Error(descriptor.reason || 'AI-ul nu a identificat un obiect de mobilier. Încearcă o fotografie mai clară.');
      api.onGenerated({descriptor, thumbnail, name: descriptor.name, size: descriptor.size}); el.dialog.close();
    });
  }
  function init(options) {
    api = options; if (el) return;
    const launcher = document.createElement('button'); launcher.type = 'button'; launcher.id = 'photoUploadBtn'; launcher.className = 'photo-upload-button';
    launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4Z"/><path d="m4 16 5-5 4 4 3-3 4 4M15 7h2"/></svg><span>Mobilier din fotografie<small>Generează cu AI extern</small></span><span aria-hidden="true">+</span>';
    document.querySelector('.model-grid').after(launcher);
    const dialog = document.createElement('dialog'); dialog.id = 'photoDialog'; dialog.setAttribute('aria-labelledby', 'photoTitle'); dialog.setAttribute('aria-describedby', 'photoIntro');
    dialog.innerHTML = `
      <button type="button" id="photoClose" class="photo-close" aria-label="Închide generarea AI">×</button>
      <header class="photo-header"><div class="eyebrow">DIN FOTOGRAFIE ÎN ATELIER</div><h2 id="photoTitle">O fotografie. Un punct de plecare.</h2><p id="photoIntro">AI-ul interpretează mobilierul și îi construiește piesele în 3D. Apoi alegi culorile, finisajele și dimensiunile potrivite.</p></header>
      <div class="photo-layout">
        <section class="photo-visual" aria-label="Fotografia mobilierului">
          <div class="photo-step"><span>01</span><h3>Alege fotografia</h3></div>
          <div class="ai-image-area" id="photoDropZone"><img id="photoPreview" alt="Fotografia aleasă pentru generarea modelului" hidden><div id="photoEmpty" class="photo-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="11" y="12" width="42" height="40" rx="4"/><path d="m12 43 14-14 13 13 7-7 7 7"/><circle cx="42" cy="23" r="3"/></svg><strong>Mobilierul tău, în 3D</strong><span>Trage o fotografie aici sau alege un fișier</span></div></div>
          <div class="photo-file-row"><button type="button" class="photo-secondary" id="photoChoose">Alege fotografia</button><span id="photoFileName">Nicio fotografie selectată</span></div>
          <input type="file" id="photoFile" accept="image/png,image/jpeg,image/webp" hidden>
          <p class="photo-small">PNG, JPG sau WEBP · maximum 12 MB. Alege un singur obiect, bine luminat. Sunt acceptate și schițe cu dimensiuni.</p>
          <div class="photo-limits"><strong>Un model editabil, cu dimensiuni estimate</strong><p>Rezultatul este o interpretare din piese geometrice, potrivită pentru mobilier cu panouri și rafturi. Formele organice și detaliile ascunse pot fi aproximative. Verifică dimensiunile înainte de a le folosi.</p></div>
        </section>
        <section class="photo-settings" aria-label="Conectarea la AI">
          <div class="photo-step"><span>02</span><h3>Conectează AI-ul preferat</h3></div>
          <label class="ai-label" for="aiProvider">Furnizor AI</label><select id="aiProvider" class="ai-input"><option value="openai">OpenAI · modelele din familia GPT</option><option value="gemini">Google Gemini</option></select>
          <p id="aiProviderNote" class="photo-small"></p><div id="aiConnection" class="ai-connection" role="status" aria-live="polite">Niciun cont AI conectat</div>
          <div id="aiKeyRow"><label class="ai-label" for="aiKey">Cheie API personală</label><input id="aiKey" class="ai-input" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="300" placeholder="Introdu cheia furnizorului" aria-describedby="aiKeyPrivacy">
            <a id="aiKeyLink" target="_blank" rel="noopener noreferrer"></a>
            <p id="aiKeyPrivacy" class="photo-small">Cheia este transmisă serverului acestui site și furnizorului ales. Sesiunea este criptată și expiră după o oră. Cheia nu intră în proiecte, linkuri sau stocarea locală a configuratorului.</p>
            <button type="button" id="aiConnect" class="photo-secondary" disabled>Conectează OpenAI</button>
          </div><button type="button" id="aiDisconnect" class="photo-secondary" hidden>Deconectează</button>
          <div class="ai-send-note"><strong>03 · Generează și personalizează</strong><p>La generare, fotografia este trimisă prin server furnizorului conectat. Se aplică politica de date și tarifele API ale acestuia. Rezultatul 3D se deschide direct în configurator.</p></div>
        </section>
      </div>
      <footer class="photo-footer"><p id="photoStatus" role="status" aria-live="polite">Alege o fotografie pentru a începe.</p><button type="button" id="photoGenerate" class="photo-primary" disabled>Generează modelul 3D →</button></footer>
      <p class="photo-small ai-cancel-note">Închiderea ferestrei oprește așteptarea; o cerere deja trimisă poate fi procesată și facturată de furnizor.</p>`;
    document.body.append(dialog);
    el = {dialog, preview: byId('photoPreview'), empty: byId('photoEmpty'), choose: byId('photoChoose'), file: byId('photoFile'), fileName: byId('photoFileName'), status: byId('photoStatus'), generate: byId('photoGenerate'), provider: byId('aiProvider'), providerNote: byId('aiProviderNote'), key: byId('aiKey'), keyRow: byId('aiKeyRow'), keyLink: byId('aiKeyLink'), connect: byId('aiConnect'), disconnect: byId('aiDisconnect'), connection: byId('aiConnection')};
    launcher.addEventListener('click', open); byId('photoClose').addEventListener('click', () => dialog.close()); dialog.addEventListener('close', interrupt);
    el.choose.addEventListener('click', () => { el.file.value = ''; el.file.click(); }); el.file.addEventListener('change', () => loadFile(el.file.files[0]));
    el.provider.addEventListener('change', () => { el.key.value = ''; render(); }); el.key.addEventListener('input', render);
    el.key.addEventListener('keydown', event => { if (event.key === 'Enter' && !el.connect.disabled) { event.preventDefault(); connect(); } });
    el.connect.addEventListener('click', connect); el.disconnect.addEventListener('click', disconnect); el.generate.addEventListener('click', generate);
    const zone = byId('photoDropZone'); zone.addEventListener('dragover', event => { event.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', event => { event.preventDefault(); zone.classList.remove('drag-over'); loadFile(event.dataTransfer.files[0]); });
    render();
  }
  window.FurniturePhotoUI = {init, open};
}());
