(function () {
  'use strict';

  const MAX_BYTES = 12 * 1024 * 1024;
  const MAX_PIXELS = 30 * 1000 * 1000;
  let api, elements, sourceImage, sourceName = '', crop = null;
  let analyzed = null, generation = 0, busy = false, previewMode = 'image';
  let dragStart = null, drawBox = null, pendingURL = null, dimensionsTouched = false;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  const byId = id => document.getElementById(id);

  function status(message, kind) {
    elements.status.textContent = message;
    elements.status.dataset.kind = kind || 'info';
  }

  function setBusy(value) {
    busy = value;
    elements.dialog.setAttribute('aria-busy', String(value));
    elements.generate.disabled = value || !sourceImage;
    elements.generate.textContent = value ? 'Separăm conturul…' : 'Generează din contur';
    elements.use.disabled = value || !analyzed;
    elements.tolerance.disabled = value || !sourceImage;
    elements.clearCrop.disabled = value || !crop;
  }

  function invalidate(message) {
    generation++;
    analyzed = null;
    previewMode = 'image';
    elements.resultTab.disabled = true;
    setBusy(false);
    elements.resultNote.hidden = true;
    updateTabs();
    if (message) status(message);
    renderPreview();
  }

  function updateTabs() {
    elements.imageTab.setAttribute('aria-pressed', String(previewMode === 'image'));
    elements.resultTab.setAttribute('aria-pressed', String(previewMode === 'mask'));
  }

  function renderPreview() {
    const canvas = elements.canvas;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#f0f1e9';
    ctx.fillRect(0, 0, w, h);
    if (!sourceImage) {
      drawBox = null;
      elements.empty.hidden = false;
      return;
    }
    elements.empty.hidden = true;
    if (previewMode === 'mask' && analyzed) {
      drawSilhouette(ctx, analyzed, w, h);
      return;
    }
    const scale = Math.min((w - 40) / sourceImage.naturalWidth, (h - 40) / sourceImage.naturalHeight);
    const iw = sourceImage.naturalWidth * scale, ih = sourceImage.naturalHeight * scale;
    drawBox = { x: (w - iw) / 2, y: (h - ih) / 2, width: iw, height: ih };
    ctx.drawImage(sourceImage, drawBox.x, drawBox.y, iw, ih);
    if (!crop) return;
    const x = drawBox.x + crop.x * iw, y = drawBox.y + crop.y * ih;
    const cw = crop.width * iw, ch = crop.height * ih;
    ctx.fillStyle = '#1e2d2855';
    ctx.fillRect(drawBox.x, drawBox.y, iw, y - drawBox.y);
    ctx.fillRect(drawBox.x, y + ch, iw, drawBox.y + ih - y - ch);
    ctx.fillRect(drawBox.x, y, x - drawBox.x, ch);
    ctx.fillRect(x + cw, y, drawBox.x + iw - x - cw, ch);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, cw, ch);
    ctx.strokeStyle = '#52664b';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeRect(x, y, cw, ch);
    ctx.setLineDash([]);
  }

  function drawSilhouette(ctx, descriptor, width, height) {
    const grid = descriptor.grid?.mask;
    const columns = descriptor.grid?.width;
    const rows = descriptor.grid?.height;
    if (!grid || !columns || !rows) {
      previewMode = 'image';
      updateTabs();
      renderPreview();
      return;
    }
    const aspect = Number(descriptor.aspect) || columns / rows;
    const ih = Math.min(height - 76, (width - 76) / aspect), iw = ih * aspect;
    const x = (width - iw) / 2, y = (height - ih) / 2;
    ctx.fillStyle = '#687b5c';
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        if (grid[row * columns + col]) {
          ctx.fillRect(x + col / columns * iw, y + row / rows * ih, iw / columns + 0.4, ih / rows + 0.4);
        }
      }
    }
    ctx.strokeStyle = '#bdc7b3';
    ctx.lineWidth = 1;
    ctx.setLineDash([7, 7]);
    ctx.strokeRect(x - 10, y - 10, iw + 20, ih + 20);
    ctx.setLineDash([]);
  }

  function pointFromEvent(event) {
    if (!drawBox) return null;
    const bounds = elements.canvas.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * elements.canvas.width / bounds.width;
    const y = (event.clientY - bounds.top) * elements.canvas.height / bounds.height;
    return { x: clamp((x - drawBox.x) / drawBox.width, 0, 1), y: clamp((y - drawBox.y) / drawBox.height, 0, 1),
      inside: x >= drawBox.x && x <= drawBox.x + drawBox.width && y >= drawBox.y && y <= drawBox.y + drawBox.height };
  }

  function releasePendingURL() {
    if (pendingURL) URL.revokeObjectURL(pendingURL);
    pendingURL = null;
  }

  async function loadFile(file) {
    if (!file) return;
    invalidate();
    const token = generation;
    releasePendingURL();
    sourceImage = null;
    crop = null;
    sourceName = '';
    elements.fileName.textContent = 'Nicio fotografie selectată';
    renderPreview();
    setBusy(false);
    if (!/^image\/(png|jpeg|webp)$/i.test(file.type)) {
      status('Alege o imagine PNG, JPG sau WEBP. Alte formate nu sunt acceptate.', 'error');
      return;
    }
    if (file.size > MAX_BYTES) {
      status('Imaginea depășește 12 MB. Alege o versiune mai mică.', 'error');
      return;
    }
    if (!file.size) {
      status('Fișierul este gol. Alege altă imagine.', 'error');
      return;
    }
    status('Deschidem fotografia în acest browser…');
    const url = URL.createObjectURL(file);
    pendingURL = url;
    const candidate = new Image();
    try {
      await new Promise((resolve, reject) => {
        candidate.onload = resolve;
        candidate.onerror = () => reject(new Error('Imaginea nu poate fi citită. Verifică fișierul sau alege altă fotografie.'));
        candidate.src = url;
      });
      if (token !== generation || !elements.dialog.open) return;
      if (!candidate.naturalWidth || !candidate.naturalHeight || candidate.naturalWidth * candidate.naturalHeight > MAX_PIXELS) {
        throw new Error('Imaginea are prea mulți pixeli. Folosește o fotografie de cel mult 30 megapixeli.');
      }
      sourceImage = candidate;
      sourceName = file.name.replace(/\.[^.]+$/, '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Mobilier din fotografie';
      elements.fileName.textContent = file.name.slice(0, 120);
      elements.width.value = String(clamp(Math.round(100 * candidate.naturalWidth / candidate.naturalHeight), 20, 400));
      elements.height.value = '100';
      elements.depth.value = '40';
      dimensionsTouched = false;
      status('Fotografia este pregătită. Dacă include alte obiecte sau cote, selectează mobilierul prin tragere.');
      setBusy(false);
      renderPreview();
    } catch (error) {
      if (token === generation && elements.dialog.open) status(error.message || 'Imaginea nu poate fi citită.', 'error');
    } finally {
      URL.revokeObjectURL(url);
      if (pendingURL === url) pendingURL = null;
    }
  }

  function validateSize() {
    const limits = { width: [20, 400], height: [20, 300], depth: [10, 180] };
    const size = {};
    for (const key of Object.keys(limits)) {
      const input = elements[key], value = Number(input.value);
      if (!input.value.trim() || !Number.isFinite(value) || value < limits[key][0] || value > limits[key][1]) {
        status('Introdu dimensiuni valide: lățime 20–400 cm, înălțime 20–300 cm și adâncime 10–180 cm.', 'error');
        input.focus();
        return null;
      }
      size[key] = Math.round(value * 10) / 10;
    }
    return size;
  }

  async function generate() {
    if (!sourceImage || busy || !validateSize()) return;
    invalidate();
    const token = generation, image = sourceImage;
    setBusy(true);
    status('Analizăm fundalul și conturul. Fotografia rămâne pe dispozitivul tău.');
    try {
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (token !== generation || !elements.dialog.open) return;
      const result = await window.FurniturePhotoAnalysis.analyze(image, {
        backgroundTolerance: Number(elements.tolerance.value),
        crop: crop ? { ...crop } : null
      });
      if (token !== generation || !elements.dialog.open) return;
      const candidate = result.descriptor || result;
      const validated = window.FurniturePhotoModel.validateDescriptor(candidate);
      if (validated === false || validated == null) throw new Error('Conturul nu poate fi transformat într-un model. Încearcă o fotografie cu fundal mai simplu.');
      analyzed = typeof validated === 'object' ? validated : candidate;
      if (!dimensionsTouched) {
        elements.width.value = String(clamp(Math.round(100 * analyzed.aspect), 20, 400));
        elements.height.value = '100';
      }
      elements.resultTab.disabled = false;
      elements.resultNote.hidden = false;
      elements.resultNote.textContent = ['Zonele de material sunt aproximative.', ...(analyzed.warnings || []).slice(0, 2)].join(' ');
      previewMode = 'mask';
      updateTabs();
      renderPreview();
      status('Contur detectat. Verifică previzualizarea și cotele, apoi deschide modelul 3D.', 'success');
    } catch (error) {
      if (token !== generation || !elements.dialog.open) return;
      analyzed = null;
      status(error.message || 'Nu am putut separa mobilierul de fundal. Ajustează toleranța sau încearcă o altă fotografie.', 'error');
    } finally {
      if (token === generation) setBusy(false);
    }
  }

  function thumbnail() {
    const area = crop || { x: 0, y: 0, width: 1, height: 1 };
    const sw = sourceImage.naturalWidth * area.width, sh = sourceImage.naturalHeight * area.height;
    const scale = Math.min(1, 400 / sw, 400 / sh);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(sourceImage, area.x * sourceImage.naturalWidth, area.y * sourceImage.naturalHeight, sw, sh, 0, 0, canvas.width, canvas.height);
    let data = canvas.toDataURL('image/jpeg', 0.75);
    if (data.length > 200000) data = canvas.toDataURL('image/jpeg', 0.4);
    return data.length <= 200000 ? data : null;
  }

  function useResult() {
    if (!analyzed || busy) return;
    const size = validateSize();
    if (!size) return;
    try {
      api.onGenerated({ descriptor: analyzed, thumbnail: thumbnail(), name: sourceName, size });
      elements.dialog.close();
    } catch (error) {
      status(error.message || 'Modelul nu a putut fi adăugat. Poți încerca din nou.', 'error');
    }
  }

  function init(options) {
    if (elements) { api = options; return; }
    api = options;
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.id = 'photoUploadBtn';
    launcher.className = 'photo-upload-button';
    launcher.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16v16H4Z"/><path d="m4 16 5-5 4 4 3-3 4 4M15 7h2"/></svg><span>Adaugă din fotografie<small>Conversie locală în 3D</small></span><span aria-hidden="true">+</span>';
    document.querySelector('.model-grid').after(launcher);
    const dialog = document.createElement('dialog');
    dialog.id = 'photoDialog';
    dialog.setAttribute('aria-labelledby', 'photoTitle');
    dialog.setAttribute('aria-describedby', 'photoIntro');
    dialog.innerHTML = `
      <button type="button" id="photoClose" class="photo-close" aria-label="Închide conversia fotografiei">×</button>
      <header class="photo-header"><div class="eyebrow">DIN FOTOGRAFIE ÎN ATELIER</div><h2 id="photoTitle">Dă-i volum ideii tale.</h2><p id="photoIntro">Conversie locală din contur. O fotografie frontală, un singur obiect, fundal uniform. Adâncimea și cotele reale se introduc manual.</p></header>
      <div class="photo-layout">
        <section class="photo-visual" aria-label="Previzualizarea fotografiei">
          <div class="photo-preview-tabs"><button type="button" id="photoImageTab" aria-pressed="true">Fotografie</button><button type="button" id="photoResultTab" aria-pressed="false" disabled>Contur detectat</button><button type="button" id="photoClearCrop" disabled>↺ Tot cadrul</button></div>
          <div class="photo-canvas-wrap"><canvas id="photoPreview" width="900" height="660" aria-label="Fotografie. Trage pe imagine pentru a selecta numai mobilierul."></canvas><div id="photoEmpty" class="photo-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="11" y="12" width="42" height="40" rx="4"/><path d="m12 43 14-14 13 13 7-7 7 7"/><circle cx="42" cy="23" r="3"/></svg><strong>Începe cu o fotografie</strong><span>PNG, JPG sau WEBP · maximum 12 MB</span></div></div>
          <p class="photo-crop-hint">Trage pe fotografie pentru a selecta mobilierul. Evită textele, cotele și obiectele din jur.</p>
          <div class="photo-file-row"><button type="button" class="photo-secondary" id="photoChoose">Alege fotografia</button><span id="photoFileName">Nicio fotografie selectată</span></div>
          <input type="file" id="photoFile" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden>
        </section>
        <section class="photo-settings" aria-label="Setările conversiei">
          <div class="photo-step"><span>01</span><h3>Separă fundalul</h3></div>
          <label class="photo-tolerance-label" for="photoTolerance">Toleranță de culoare <output id="photoToleranceValue" for="photoTolerance">30</output></label>
          <input type="range" id="photoTolerance" min="10" max="100" step="1" value="30" disabled>
          <p class="photo-small">Crește valoarea dacă rămâne fundal. Redu-o dacă se pierd părți din obiect.</p>
          <div class="photo-step"><span>02</span><h3>Introdu dimensiunile</h3></div>
          <div class="photo-size-grid"><label for="photoWidth">Lățime<span><input id="photoWidth" type="number" min="20" max="400" step="0.1" value="100" inputmode="decimal">cm</span></label><label for="photoHeight">Înălțime<span><input id="photoHeight" type="number" min="20" max="300" step="0.1" value="100" inputmode="decimal">cm</span></label><label for="photoDepth">Adâncime<span><input id="photoDepth" type="number" min="10" max="180" step="0.1" value="40" inputmode="decimal">cm</span></label></div>
          <p class="photo-small">Valorile inițiale sunt orientative, nu măsurători din fotografie. Le poți modifica și în configurator.</p>
          <div class="photo-limits"><strong>Un model 3D simplificat</strong><p>Conturul primește adâncime; fețele laterale și spatele sunt aproximative. Blatul, fronturile și carcasa vor putea fi recolorate. Nu sunt reconstruite mecanisme sau detalii ascunse.</p></div>
        </section>
      </div>
      <footer class="photo-footer"><div><p id="photoStatus" role="status" aria-live="polite">Nicio imagine nu este trimisă pe internet.</p><p id="photoResultNote" class="photo-small" hidden>Zonele de material sunt aproximative. Rezultatul poate fi ajustat prin culori și dimensiuni.</p></div><div class="photo-actions"><button type="button" class="photo-secondary" id="photoGenerate" disabled>Generează din contur</button><button type="button" class="photo-primary" id="photoUse" disabled>Folosește modelul →</button></div></footer>`;
    document.body.append(dialog);
    elements = { dialog, launcher, canvas: byId('photoPreview'), empty: byId('photoEmpty'), choose: byId('photoChoose'), file: byId('photoFile'), fileName: byId('photoFileName'),
      generate: byId('photoGenerate'), use: byId('photoUse'), status: byId('photoStatus'), tolerance: byId('photoTolerance'), width: byId('photoWidth'), height: byId('photoHeight'), depth: byId('photoDepth'),
      clearCrop: byId('photoClearCrop'), imageTab: byId('photoImageTab'), resultTab: byId('photoResultTab'), resultNote: byId('photoResultNote') };
    launcher.addEventListener('click', open);
    byId('photoClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => {
      const interrupted = busy || !!pendingURL;
      generation++;
      dragStart = null;
      releasePendingURL();
      setBusy(false);
      if (interrupted) status(sourceImage ? 'Conversia a fost întreruptă. Poți genera din nou conturul.' : 'Deschiderea fotografiei a fost întreruptă. Alege din nou imaginea.');
    });
    elements.choose.addEventListener('click', () => { elements.file.value = ''; elements.file.click(); });
    elements.file.addEventListener('change', () => loadFile(elements.file.files[0]));
    elements.generate.addEventListener('click', generate);
    elements.use.addEventListener('click', useResult);
    for (const input of [elements.width, elements.height, elements.depth]) input.addEventListener('input', () => { dimensionsTouched = true; });
    elements.tolerance.addEventListener('input', () => {
      byId('photoToleranceValue').value = elements.tolerance.value;
      invalidate('Toleranța a fost schimbată. Generează din nou conturul.');
    });
    elements.clearCrop.addEventListener('click', () => { crop = null; invalidate('Fotografia întreagă este selectată. Generează din nou conturul.'); });
    elements.imageTab.addEventListener('click', () => { previewMode = 'image'; updateTabs(); renderPreview(); });
    elements.resultTab.addEventListener('click', () => { previewMode = 'mask'; updateTabs(); renderPreview(); });
    elements.canvas.addEventListener('pointerdown', event => {
      if (!sourceImage || busy || previewMode !== 'image' || event.button !== 0) return;
      const point = pointFromEvent(event);
      if (!point?.inside) return;
      invalidate();
      dragStart = point;
      crop = { x: point.x, y: point.y, width: 0, height: 0 };
      elements.canvas.setPointerCapture(event.pointerId);
      renderPreview();
    });
    elements.canvas.addEventListener('pointermove', event => {
      if (!dragStart) return;
      const point = pointFromEvent(event);
      if (!point) return;
      crop = { x: Math.min(dragStart.x, point.x), y: Math.min(dragStart.y, point.y), width: Math.abs(point.x - dragStart.x), height: Math.abs(point.y - dragStart.y) };
      renderPreview();
    });
    const finishCrop = () => {
      if (!dragStart) return;
      dragStart = null;
      if (crop.width < 0.04 || crop.height < 0.04) crop = null;
      setBusy(false);
      status(crop ? 'Zona este selectată. Păstrează o margine de fundal în jurul obiectului, apoi generează conturul.' : 'Fotografia întreagă este selectată.');
      renderPreview();
    };
    elements.canvas.addEventListener('pointerup', finishCrop);
    elements.canvas.addEventListener('pointercancel', finishCrop);
    renderPreview();
  }

  function open() {
    if (!elements) return;
    elements.dialog.showModal();
    renderPreview();
    if (!sourceImage) elements.choose.focus();
  }

  window.FurniturePhotoUI = { init, open };
}());
