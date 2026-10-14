(function () {
  'use strict';

  // Local, deterministic silhouette extraction. This does not identify furniture
  // or recover the hidden side of an object from a photograph.
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (a, b) => Math.sqrt(((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) / 3);
  const hex = values => '#' + values.map(value => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0')).join('');
  const median = values => {
    if (!values.length) return 0;
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };

  function connectedComponents(mask, width, height) {
    const labels = new Int32Array(mask.length);
    const queue = new Int32Array(mask.length);
    const components = [];
    for (let start = 0; start < mask.length; start++) {
      if (!mask[start] || labels[start]) continue;
      const component = { id: components.length + 1, area: 0, left: width, right: 0, top: height, bottom: 0 };
      let head = 0, tail = 1;
      queue[0] = start;
      labels[start] = component.id;
      while (head < tail) {
        const index = queue[head++], x = index % width, y = Math.floor(index / width);
        component.area++;
        component.left = Math.min(component.left, x);
        component.right = Math.max(component.right, x);
        component.top = Math.min(component.top, y);
        component.bottom = Math.max(component.bottom, y);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if ((!dx && !dy) || nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
            const next = ny * width + nx;
            if (mask[next] && !labels[next]) {
              labels[next] = component.id;
              queue[tail++] = next;
            }
          }
        }
      }
      components.push(component);
    }
    return { labels, components: components.sort((a, b) => b.area - a.area) };
  }

  function backgroundEstimate(data, width, height, tolerance) {
    const samples = [];
    const band = Math.max(1, Math.floor(Math.min(width, height) * 0.025));
    let transparent = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= band && x < width - band && y >= band && y < height - band) continue;
        const index = (y * width + x) * 4;
        if (data[index + 3] < 32) transparent++;
        samples.push([data[index], data[index + 1], data[index + 2], data[index + 3]]);
      }
    }
    if (transparent / samples.length > 0.6) return { transparent: true, color: [255, 255, 255], uniformity: transparent / samples.length };
    const opaque = samples.filter(pixel => pixel[3] >= 128);
    if (!opaque.length) throw new Error('Imaginea nu conține suficienți pixeli vizibili.');
    const bins = new Map();
    for (const pixel of opaque) {
      const key = (pixel[0] >> 4) * 256 + (pixel[1] >> 4) * 16 + (pixel[2] >> 4);
      if (!bins.has(key)) bins.set(key, []);
      bins.get(key).push(pixel);
    }
    const dominant = [...bins.values()].sort((a, b) => b.length - a.length)[0];
    const seed = [0, 1, 2].map(channel => median(dominant.map(pixel => pixel[channel])));
    const cluster = opaque.filter(pixel => distance(pixel, seed) < Math.min(36, tolerance + 10));
    const color = [0, 1, 2].map(channel => median(cluster.map(pixel => pixel[channel])));
    const uniformity = samples.filter(pixel => pixel[3] < 32 || distance(pixel, color) <= tolerance).length / samples.length;
    return { transparent: false, color, uniformity };
  }

  function exteriorBackground(mask, width, height) {
    const exterior = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
    let head = 0, tail = 0;
    const add = index => {
      if (!mask[index] && !exterior[index]) {
        exterior[index] = 1;
        queue[tail++] = index;
      }
    };
    for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      if (x) add(index - 1);
      if (x + 1 < width) add(index + 1);
      if (y) add(index - width);
      if (y + 1 < height) add(index + width);
    }
    return exterior;
  }

  function trimSoftFloorShadow(data, mask, width, height, background) {
    if (background.transparent) return 0;
    const backgroundLight = background.color.reduce((sum, value) => sum + value, 0) / 3;
    if (backgroundLight < 220) return 0;
    const lights = [];
    for (let index = 0; index < mask.length; index++) {
      if (mask[index]) lights.push((data[index * 4] + data[index * 4 + 1] + data[index * 4 + 2]) / 3);
    }
    const medianLight = median(lights);
    // Restrict this heuristic to predominantly dark objects. A white cabinet
    // against a white wall needs its light panels, even near the floor.
    if (medianLight > 125) return 0;
    const contrast = Math.max(85, (backgroundLight - medianLight) * 0.6);
    const core = new Uint8Array(mask.length);
    for (let index = 0; index < mask.length; index++) {
      const offset = index * 4;
      if (mask[index] && distance([data[offset], data[offset + 1], data[offset + 2]], background.color) > contrast) core[index] = 1;
    }
    const primary = connectedComponents(core, width, height).components[0];
    if (!primary || primary.area < lights.length * 0.5) return 0;
    const floorStart = primary.top + (primary.bottom - primary.top) * 0.7;
    let removed = 0;
    for (let y = Math.floor(floorStart); y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x >= primary.left - 1 && x <= primary.right + 1 && y <= primary.bottom + 1) continue;
        const index = y * width + x, offset = index * 4;
        if (!mask[index] || core[index]) continue;
        const red = data[offset], green = data[offset + 1], blue = data[offset + 2];
        if (Math.max(red, green, blue) - Math.min(red, green, blue) <= 18) { mask[index] = 0; removed++; }
      }
    }
    return removed;
  }

  function representativeColor(data, selected, width, box, region, fallback) {
    const bins = new Map();
    for (let y = box.top; y <= box.bottom; y++) {
      for (let x = box.left; x <= box.right; x++) {
        const index = y * width + x;
        if (!selected[index]) continue;
        const u = (x - box.left) / Math.max(1, box.right - box.left);
        const v = (y - box.top) / Math.max(1, box.bottom - box.top);
        if (!region(u, v)) continue;
        const offset = index * 4;
        const pixel = [data[offset], data[offset + 1], data[offset + 2]];
        const key = (pixel[0] >> 5) * 64 + (pixel[1] >> 5) * 8 + (pixel[2] >> 5);
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(pixel);
      }
    }
    if (!bins.size) return fallback;
    const dominant = [...bins.values()].sort((a, b) => b.length - a.length)[0];
    return hex([0, 1, 2].map(channel => median(dominant.map(pixel => pixel[channel]))));
  }

  function detectDividers(data, selected, width, box) {
    const boxWidth = box.right - box.left + 1, boxHeight = box.bottom - box.top + 1;
    const result = { vertical: [], horizontal: [] };
    for (const vertical of [true, false]) {
      const length = vertical ? boxWidth : boxHeight;
      const span = vertical ? boxHeight : boxWidth;
      const scores = new Float32Array(length);
      for (let position = 2; position < length - 2; position++) {
        let edges = 0;
        for (let cross = 1; cross < span - 1; cross++) {
          const x = box.left + (vertical ? position : cross);
          const y = box.top + (vertical ? cross : position);
          const index = y * width + x;
          const neighbor = index - (vertical ? 1 : width);
          if (!selected[index] || !selected[neighbor]) continue;
          const a = index * 4, b = neighbor * 4;
          const gradient = Math.sqrt(((data[a] - data[b]) ** 2 + (data[a + 1] - data[b + 1]) ** 2 + (data[a + 2] - data[b + 2]) ** 2) / 3);
          if (gradient > 22) edges++;
        }
        scores[position] = edges / span;
      }
      const threshold = Math.max(0.27, median(Array.from(scores)) * 4);
      const peaks = [];
      for (let position = 2; position < length - 2; position++) {
        const normalized = position / length;
        if (normalized < 0.07 || normalized > 0.93 || scores[position] < threshold) continue;
        const nearby = peaks.find(peak => Math.abs(peak.position - position) < Math.max(3, length * 0.045));
        if (nearby) {
          if (scores[position] > nearby.score) { nearby.position = position; nearby.score = scores[position]; }
        } else peaks.push({ position, score: scores[position] });
      }
      result[vertical ? 'vertical' : 'horizontal'] = peaks.sort((a, b) => b.score - a.score).slice(0, 8).map(peak => +(peak.position / length).toFixed(4)).sort((a, b) => a - b);
    }
    return result;
  }

  async function analyze(imageSource, options) {
    options = options || {};
    const sourceWidth = Number(imageSource && (imageSource.naturalWidth || imageSource.videoWidth || imageSource.width));
    const sourceHeight = Number(imageSource && (imageSource.naturalHeight || imageSource.videoHeight || imageSource.height));
    if (!Number.isFinite(sourceWidth) || !Number.isFinite(sourceHeight) || sourceWidth < 16 || sourceHeight < 16) {
      throw new Error('Imaginea nu poate fi citită sau este prea mică. Alege o imagine de cel puțin 16 × 16 pixeli.');
    }
    const cropInput = options.crop || { x: 0, y: 0, width: 1, height: 1 };
    if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(Number(cropInput[key])))) throw new Error('Zona de decupare nu este validă.');
    const crop = { x: clamp(Number(cropInput.x), 0, 0.99), y: clamp(Number(cropInput.y), 0, 0.99) };
    crop.width = Math.min(1 - crop.x, Math.max(0, Number(cropInput.width)));
    crop.height = Math.min(1 - crop.y, Math.max(0, Number(cropInput.height)));
    if (crop.width * sourceWidth < 16 || crop.height * sourceHeight < 16) throw new Error('Zona de decupare este prea mică. Mărește selecția în jurul mobilierului.');
    const toleranceInput = Number(options.backgroundTolerance);
    const tolerance = Number.isFinite(toleranceInput) ? clamp(toleranceInput, 10, 100) : 28;
    const scale = Math.min(1, 256 / Math.max(sourceWidth * crop.width, sourceHeight * crop.height));
    const width = Math.max(1, Math.round(sourceWidth * crop.width * scale));
    const height = Math.max(1, Math.round(sourceHeight * crop.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Browserul nu permite analiza imaginilor. Încearcă un browser actualizat.');
    let data;
    try {
      context.drawImage(imageSource, crop.x * sourceWidth, crop.y * sourceHeight, crop.width * sourceWidth, crop.height * sourceHeight, 0, 0, width, height);
      data = context.getImageData(0, 0, width, height).data;
    } catch (error) {
      throw new Error('Imaginea nu a putut fi analizată. Încarcă un fișier PNG, JPEG sau WebP de pe dispozitiv.');
    }
    // Yield once before the bounded pixel analysis so the UI can show progress.
    await new Promise(resolve => setTimeout(resolve, 0));
    const background = backgroundEstimate(data, width, height, tolerance);
    if (background.uniformity < 0.48) {
      throw new Error('Nu pot separa obiectul de acest fundal. Decupează mai aproape de mobilier sau folosește o fotografie pe fundal simplu.');
    }
    const mask = new Uint8Array(width * height);
    let rawArea = 0;
    for (let index = 0; index < mask.length; index++) {
      const offset = index * 4;
      const visible = data[offset + 3] >= 80;
      const foreground = visible && (background.transparent || distance([data[offset], data[offset + 1], data[offset + 2]], background.color) > tolerance);
      if (foreground) { mask[index] = 1; rawArea++; }
    }
    if (rawArea < Math.max(24, mask.length * 0.006) || rawArea > mask.length * 0.95) {
      throw new Error('Nu am găsit un contur separat de fundal. Alege o imagine cu un singur obiect, bine contrastat.');
    }
    const shadowRemoved = trimSoftFloorShadow(data, mask, width, height, background);
    rawArea -= shadowRemoved;
    const exterior = exteriorBackground(mask, width, height);
    // Background-like enclosed openings are intentionally kept empty. Filling
    // every enclosed region would turn chair legs and open shelves into walls.
    const { labels, components } = connectedComponents(mask, width, height);
    const largest = components[0];
    if (!largest || largest.area < Math.max(24, mask.length * 0.012)) {
      throw new Error('Conturul este prea fragmentat pentru un volum 3D. Folosește o imagine mai clară, fără cote sau texte.');
    }
    const originalWidth = largest.right - largest.left + 1;
    const originalHeight = largest.bottom - largest.top + 1;
    const padding = Math.max(2, Math.min(originalWidth, originalHeight) * 0.06);
    const retained = new Set([largest.id]);
    const box = { left: largest.left, right: largest.right, top: largest.top, bottom: largest.bottom };
    // Preserve adjacent disconnected panels, but discard small annotation/text
    // islands and background specks outside the object's main silhouette.
    for (const component of components.slice(1)) {
      const close = component.left <= largest.right + padding && component.right >= largest.left - padding && component.top <= largest.bottom + padding && component.bottom >= largest.top - padding;
      const centered = component.left >= largest.left - padding && component.right <= largest.right + padding && component.top >= largest.top - padding && component.bottom <= largest.bottom + padding;
      const centerInside = (component.left + component.right) / 2 >= largest.left && (component.left + component.right) / 2 <= largest.right && (component.top + component.bottom) / 2 >= largest.top && (component.top + component.bottom) / 2 <= largest.bottom;
      if (close && centered && centerInside && component.area >= Math.max(10, largest.area * 0.012)) {
        retained.add(component.id);
        box.left = Math.min(box.left, component.left); box.right = Math.max(box.right, component.right);
        box.top = Math.min(box.top, component.top); box.bottom = Math.max(box.bottom, component.bottom);
      }
    }
    const selected = new Uint8Array(mask.length);
    let area = 0, holes = 0;
    for (let index = 0; index < mask.length; index++) {
      if (retained.has(labels[index])) { selected[index] = 1; area++; }
      else if (!mask[index] && !exterior[index]) holes++;
    }
    const boxWidth = box.right - box.left + 1, boxHeight = box.bottom - box.top + 1;
    const occupancy = area / (boxWidth * boxHeight);
    const dominance = area / rawArea;
    const substantialComponents = components.filter(component => component.area >= Math.max(10, rawArea * 0.004)).length;
    if (boxWidth < 8 || boxHeight < 8 || occupancy < 0.055 || dominance < 0.30 || (substantialComponents > 24 && dominance < 0.7)) {
      throw new Error('Imaginea are prea multe detalii separate pentru a izola mobilierul. Decupează obiectul și elimină textele sau obiectele din jur.');
    }
    if (boxWidth / boxHeight > 7 || boxHeight / boxWidth > 8) {
      throw new Error('Am detectat doar un contur foarte îngust. Include întregul obiect și păstrează puțin fundal în jur.');
    }
    const step = Math.max(1, boxWidth / 48, boxHeight / 64);
    const gridWidth = Math.min(48, Math.ceil(boxWidth / step)), gridHeight = Math.min(64, Math.ceil(boxHeight / step));
    const gridMask = [];
    for (let gy = 0; gy < gridHeight; gy++) {
      for (let gx = 0; gx < gridWidth; gx++) {
        const startX = box.left + Math.floor(gx * boxWidth / gridWidth);
        const endX = box.left + Math.floor((gx + 1) * boxWidth / gridWidth);
        const startY = box.top + Math.floor(gy * boxHeight / gridHeight);
        const endY = box.top + Math.floor((gy + 1) * boxHeight / gridHeight);
        let occupied = 0, samples = 0;
        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) { occupied += selected[y * width + x]; samples++; }
        }
        // A low coverage threshold keeps narrow furniture legs at this resolution.
        gridMask.push(samples && occupied / samples >= 0.18 ? 1 : 0);
      }
    }
    if (gridMask.reduce((sum, value) => sum + value, 0) < 12) throw new Error('Nu am putut forma un volum util. Încearcă o imagine mai apropiată și cu fundal uniform.');
    const fallback = representativeColor(data, selected, width, box, () => true, '#808080');
    const colors = {
      body: representativeColor(data, selected, width, box, (u, v) => (u < 0.25 || u > 0.75) && v > 0.2, fallback),
      fronts: representativeColor(data, selected, width, box, (u, v) => u >= 0.2 && u <= 0.8 && v >= 0.2 && v <= 0.9, fallback),
      top: representativeColor(data, selected, width, box, (u, v) => v < 0.22, fallback)
    };
    const warnings = [];
    if (shadowRemoved > area * 0.015) warnings.push('O umbră deschisă din zona bazei a fost eliminată. Verifică marginile de jos ale modelului.');
    if (background.uniformity < 0.8) warnings.push('Fundalul este neuniform; pot rămâne porțiuni care nu aparțin mobilierului.');
    if (dominance < 0.85) warnings.push('Au fost eliminate detalii separate din jurul conturului principal. Verifică dacă lipsește vreo componentă.');
    if (occupancy < 0.2 || holes > area * 0.5) warnings.push('Există multe goluri sau suprafețe apropiate de culoarea fundalului. Verifică forma și ajustează separarea fundalului.');
    if (box.left <= 1 || box.top <= 1 || box.right >= width - 2 || box.bottom >= height - 2) warnings.push('Obiectul atinge marginea imaginii; este posibil ca o parte să fie tăiată.');
    return {
      version: 1,
      grid: { width: gridWidth, height: gridHeight, mask: gridMask },
      aspect: boxWidth / boxHeight,
      colors,
      confidence: warnings.length ? 'limited' : 'good',
      warnings,
      dividers: detectDividers(data, selected, width, box),
      bounds: { x: crop.x + box.left / width * crop.width, y: crop.y + box.top / height * crop.height, width: boxWidth / width * crop.width, height: boxHeight / height * crop.height },
      sourceWidth,
      sourceHeight
    };
  }

  window.FurniturePhotoAnalysis = { analyze };
})();
