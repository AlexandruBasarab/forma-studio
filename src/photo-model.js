/* Editable furniture from validated AI parts, plus legacy silhouette projects.
 * Centimetres; positive Y is up and front faces +Z. Models contain closed 3D
 * geometry, never a plane carrying the uploaded photograph or generated code.
 */
(function () {
  'use strict';

  const MAX_WIDTH = 48, MAX_HEIGHT = 64;
  const DEFAULT_COLORS = { body: '#d9d3c8', fronts: '#a6aa99', top: '#c5a277' };
  const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

  function appearance(options, photo, role) {
    const sourceRole = role === 'frontsUpper' || role === 'frontsLower' ? 'fronts' : role;
    const selectedFinish = options[role + 'Finish'] || options[sourceRole + 'Finish'];
    return {
      color: validColor(options[role]) ? options[role] : validColor(options[sourceRole]) ? options[sourceRole]
        : photo.colors[sourceRole] || DEFAULT_COLORS[sourceRole],
      finish: ['matte', 'wood', 'stone'].includes(selectedFinish) ? selectedFinish : 'matte'
    };
  }

  function validateDescriptor(value) {
    if (isRecord(value) && value.version === 2) {
      if (!globalThis.FurnitureAI) throw new Error('Validatorul pentru modelele AI nu este disponibil.');
      const descriptor = globalThis.FurnitureAI.validateDescriptor(value);
      if (descriptor.kind !== 'furniture') throw new Error(descriptor.reason || 'AI-ul nu a identificat un obiect de mobilier.');
      return descriptor;
    }
    if (!isRecord(value) || value.version !== 1 || !isRecord(value.grid)) {
      throw new Error('Modelul din imagine are un format necunoscut.');
    }
    const { width, height, mask } = value.grid;
    if (!Number.isInteger(width) || width < 1 || width > MAX_WIDTH ||
        !Number.isInteger(height) || height < 1 || height > MAX_HEIGHT ||
        !Array.isArray(mask) || mask.length !== width * height ||
        !Array.from(mask).every(cell => cell === 0 || cell === 1)) {
      throw new Error('Silueta modelului trebuie să conțină o grilă binară de cel mult 48 × 64 celule.');
    }
    if (!mask.some(Boolean)) throw new Error('Nu există o siluetă de mobilier în acest model.');
    if (!finite(value.aspect) || value.aspect < 0.01 || value.aspect > 100) {
      throw new Error('Proporțiile imaginii sunt invalide.');
    }
    if (!isRecord(value.colors) || !['body', 'fronts', 'top'].every(role => validColor(value.colors[role]))) {
      throw new Error('Culorile modelului din imagine sunt invalide.');
    }
    if (!['good', 'limited'].includes(value.confidence)) {
      throw new Error('Calitatea estimării din imagine este invalidă.');
    }
    if (!Array.isArray(value.warnings) || value.warnings.length > 12 ||
        !Array.from(value.warnings).every(message => typeof message === 'string' && message.length <= 240)) {
      throw new Error('Observațiile modelului din imagine sunt invalide.');
    }
    const bounds = value.bounds;
    if (!isRecord(bounds) || !['x', 'y', 'width', 'height'].every(key => finite(bounds[key])) ||
        bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0 ||
        bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) {
      throw new Error('Încadrarea siluetei în imagine este invalidă.');
    }
    if (![value.sourceWidth, value.sourceHeight].every(n => Number.isInteger(n) && n > 0 && n <= 30000)) {
      throw new Error('Dimensiunile imaginii sursă sunt invalide.');
    }
    let dividers;
    if (value.dividers !== undefined) {
      if (!isRecord(value.dividers) || !['vertical', 'horizontal'].every(axis =>
        Array.isArray(value.dividers[axis]) && value.dividers[axis].length <= 8 &&
        Array.from(value.dividers[axis]).every(n => finite(n) && n > 0 && n < 1))) {
        throw new Error('Liniile de separare ale fronturilor sunt invalide.');
      }
      dividers = Object.fromEntries(['vertical', 'horizontal'].map(axis =>
        [axis, Array.from(new Set(value.dividers[axis])).sort((a, b) => a - b)]));
    }
    return {
      version: 1,
      grid: { width, height, mask: mask.slice() },
      aspect: value.aspect,
      colors: Object.fromEntries(['body', 'fronts', 'top'].map(role => [role, value.colors[role].toLowerCase()])),
      confidence: value.confidence,
      warnings: value.warnings.map(message => message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()),
      bounds: { x: bounds.x, y: bounds.y, width: Math.min(bounds.width, 1 - bounds.x), height: Math.min(bounds.height, 1 - bounds.y) },
      sourceWidth: value.sourceWidth,
      sourceHeight: value.sourceHeight,
      ...(dividers ? { dividers } : {})
    };
  }

  function finishTexture(T, finish) {
    if (finish !== 'wood' && finish !== 'stone') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fafaf8'; ctx.fillRect(0, 0, 128, 128);
    if (finish === 'wood') {
      for (let i = 0; i < 75; i++) {
        const y = (i * 13.73) % 128;
        ctx.strokeStyle = 'rgba(65,60,52,' + (0.025 + (i % 7) * 0.009) + ')';
        ctx.lineWidth = 0.35 + (i % 4) * 0.15;
        ctx.beginPath(); ctx.moveTo(0, y);
        ctx.bezierCurveTo(36, y + Math.sin(i) * 3, 80, y - Math.cos(i) * 2, 128, y + Math.sin(i * 3));
        ctx.stroke();
      }
    } else {
      for (let i = 0; i < 600; i++) {
        ctx.fillStyle = 'rgba(95,90,82,' + (0.02 + (i % 5) * 0.007) + ')';
        ctx.fillRect((i * 37.137) % 128, (i * 21.591) % 128, 0.5 + i % 2, 0.5 + i % 2);
      }
    }
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    return texture;
  }

  function build(options) {
    const T = window.THREE;
    if (!T) throw new Error('Motorul de vizualizare 3D nu este disponibil.');
    const o = options || {}, photo = validateDescriptor(o.photo);
    if (photo.version === 2) return buildAIParts(T, o, photo);
    const size = Object.assign({ width: 100, height: Math.max(20, Math.min(300, 100 / photo.aspect)), depth: 45 }, o.size);
    const limits = { width: [20, 400], height: [20, 300], depth: [10, 180] };
    for (const key of Object.keys(limits)) {
      if (!finite(size[key]) || size[key] < limits[key][0] || size[key] > limits[key][1]) {
        throw new Error('Dimensiune invalidă pentru modelul din imagine: ' + key + '.');
      }
    }

    // Remove padding but retain holes, leg gaps and disconnected visible parts.
    // The occupied silhouette always spans the exact requested nominal size.
    const raw = photo.grid;
    let minX = raw.width, minY = raw.height, maxX = -1, maxY = -1, filled = 0;
    for (let y = 0; y < raw.height; y++) for (let x = 0; x < raw.width; x++) {
      if (!raw.mask[y * raw.width + x]) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y); filled++;
    }
    const originalColumns = maxX - minX + 1, originalRows = maxY - minY + 1;
    const dividers = photo.dividers || { vertical: [], horizontal: [] };
    const grooveWidth = Math.max(0.25, Math.min(0.65, size.width * 0.0025));
    const grooveDepth = Math.min(0.75, size.depth * 0.04);
    const makeBands = (lines, length) => lines.map(n => [Math.max(0, n - grooveWidth / length / 2), Math.min(1, n + grooveWidth / length / 2)]);
    const xBands = makeBands(dividers.vertical, size.width), yBands = makeBands(dividers.horizontal, size.height);
    const edges = (count, bands, extra = []) => Array.from(new Set([
      ...Array.from({ length: count + 1 }, (_, i) => i / count), ...bands.flat(), ...extra
    ])).sort((a, b) => a - b);
    // Retain the closed silhouette while separating front materials at mid-height,
    // including grids with an odd number of rows or a single occupied row.
    const xEdges = edges(originalColumns, xBands), yEdges = edges(originalRows, yBands, [0.5]);
    const columns = xEdges.length - 1, rows = yEdges.length - 1;
    const mask = new Uint8Array(columns * rows);
    let volumeCm3 = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const nx = (xEdges[x] + xEdges[x + 1]) / 2, ny = (yEdges[y] + yEdges[y + 1]) / 2;
      const sourceX = Math.min(originalColumns - 1, Math.floor(nx * originalColumns));
      const sourceY = Math.min(originalRows - 1, Math.floor(ny * originalRows));
      if (!raw.mask[(sourceY + minY) * raw.width + sourceX + minX]) continue;
      const groove = xBands.some(([a, b]) => nx > a && nx < b) || yBands.some(([a, b]) => ny > a && ny < b);
      mask[y * columns + x] = groove ? 2 : 1;
      volumeCm3 += (xEdges[x + 1] - xEdges[x]) * size.width * (yEdges[y + 1] - yEdges[y]) * size.height * (size.depth - (groove ? grooveDepth : 0));
    }
    const kindAt = (x, y) => x >= 0 && x < columns && y >= 0 && y < rows ? mask[y * columns + x] : 0;
    const occupied = (x, y) => kindAt(x, y) > 0;
    const atX = x => -size.width / 2 + xEdges[x] * size.width;
    const atY = y => size.height - yEdges[y] * size.height;
    const rear = -size.depth / 2, front = size.depth / 2;
    const frontAt = kind => kind === 0 ? rear : kind === 2 ? front - grooveDepth : front;
    const frontRole = row => yEdges[row] < 0.5 ? 'frontsUpper' : 'frontsLower';
    const surfaces = Object.fromEntries(['body', 'frontsUpper', 'frontsLower', 'top'].map(role => [role, { positions: [], normals: [], uvs: [], indices: [] }]));
    let rectangleCount = 0, boundaryCount = 0;

    function quad(role, vertices, normal) {
      const surface = surfaces[role], start = surface.positions.length / 3;
      for (const point of vertices) {
        surface.positions.push(...point); surface.normals.push(...normal);
        // World-space texture scale gives consistent grain across merged faces.
        if (normal[1]) surface.uvs.push(point[0] / 80, point[2] / 80);
        else if (normal[0]) surface.uvs.push(point[2] / 80, point[1] / 80);
        else surface.uvs.push(point[0] / 80, point[1] / 80);
      }
      surface.indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }

    // Greedy rectangles on the front/back avoid one draw call per cell.
    // Only exterior boundary faces are generated: no hidden internal walls.
    const visited = new Uint8Array(mask.length);
    for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
      if (!occupied(col, row) || visited[row * columns + col]) continue;
      const kind = kindAt(col, row), surfaceZ = frontAt(kind);
      let width = 1, height = 1;
      while (col + width < columns && kindAt(col + width, row) === kind && !visited[row * columns + col + width]) width++;
      let extend = true;
      while (row + height < rows && extend) {
        if (kind !== 2 && frontRole(row + height) !== frontRole(row)) break;
        for (let dx = 0; dx < width; dx++) {
          if (kindAt(col + dx, row + height) !== kind || visited[(row + height) * columns + col + dx]) { extend = false; break; }
        }
        if (extend) height++;
      }
      for (let dy = 0; dy < height; dy++) for (let dx = 0; dx < width; dx++) visited[(row + dy) * columns + col + dx] = 1;
      const left = atX(col), right = atX(col + width), top = atY(row), bottom = atY(row + height);
      quad(kind === 2 ? 'body' : frontRole(row), [[left, bottom, surfaceZ], [right, bottom, surfaceZ], [right, top, surfaceZ], [left, top, surfaceZ]], [0, 0, 1]);
      quad('body', [[right, bottom, rear], [left, bottom, rear], [left, top, rear], [right, top, rear]], [0, 0, -1]);
      rectangleCount++;
    }

    // Consecutive exposed horizontal edges form a single top or bottom face.
    for (let row = 0; row < rows; row++) for (const direction of [-1, 1]) {
      let col = 0;
      while (col < columns) {
        const kind = kindAt(col, row), neighbor = kindAt(col, row + direction);
        if (!kind || frontAt(kind) <= frontAt(neighbor)) { col++; continue; }
        const start = col++;
        while (col < columns && kindAt(col, row) === kind && kindAt(col, row + direction) === neighbor) col++;
        const left = atX(start), right = atX(col), y = atY(row + (direction === 1 ? 1 : 0));
        const z0 = frontAt(neighbor), z1 = frontAt(kind);
        if (direction === -1) quad(neighbor ? 'body' : 'top', [[left, y, z0], [left, y, z1], [right, y, z1], [right, y, z0]], [0, 1, 0]);
        else quad('body', [[left, y, z1], [left, y, z0], [right, y, z0], [right, y, z1]], [0, -1, 0]);
        boundaryCount++;
      }
    }
    for (let col = 0; col < columns; col++) for (const direction of [-1, 1]) {
      let row = 0;
      while (row < rows) {
        const kind = kindAt(col, row), neighbor = kindAt(col + direction, row);
        if (!kind || frontAt(kind) <= frontAt(neighbor)) { row++; continue; }
        const start = row++;
        while (row < rows && kindAt(col, row) === kind && kindAt(col + direction, row) === neighbor) row++;
        const top = atY(start), bottom = atY(row), x = atX(col + (direction === 1 ? 1 : 0));
        const z0 = frontAt(neighbor), z1 = frontAt(kind);
        if (direction === -1) quad('body', [[x, bottom, z0], [x, bottom, z1], [x, top, z1], [x, top, z0]], [-1, 0, 0]);
        else quad('body', [[x, bottom, z1], [x, bottom, z0], [x, top, z0], [x, top, z1]], [1, 0, 0]);
        boundaryCount++;
      }
    }

    const group = new T.Group();
    group.name = 'photo';
    group.userData = {
      modelType: 'photo', technique: 'silhouette-extrusion', dimensions: { ...size },
      sourceAspect: photo.aspect, confidence: photo.confidence, filledCells: filled,
      rectangleCount, boundaryCount, depthEstimated: true,
      volumeCm3,
      note: 'Volum aproximativ extrudat din siluetă; adâncimea este aleasă de utilizator, iar construcția ascunsă nu este dedusă.'
    };
    for (const role of ['body', 'frontsUpper', 'frontsLower', 'top']) {
      if (!surfaces[role].positions.length) continue;
      const data = surfaces[role], geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(data.positions, 3));
      geometry.setAttribute('normal', new T.Float32BufferAttribute(data.normals, 3));
      geometry.setAttribute('uv', new T.Float32BufferAttribute(data.uvs, 2));
      geometry.setIndex(data.indices);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const { color, finish } = appearance(o, photo, role);
      const params = {
        color,
        roughness: finish === 'stone' ? 0.4 : 0.64, metalness: 0.02
      };
      const map = finishTexture(T, finish);
      if (map) params.map = map;
      const material = new T.MeshStandardMaterial(params);
      material.name = 'photo-material-' + role;
      material.userData = { role, finish };
      const mesh = new T.Mesh(geometry, material);
      mesh.name = 'photo-' + role;
      mesh.userData.role = role;
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    }
    return { group, width: size.width, height: size.height, depth: size.depth };
  }

  function buildAIParts(T, options, photo) {
    const size = { ...photo.size, ...options.size };
    const limits = { width: [20, 400], height: [20, 300], depth: [10, 180] };
    for (const [key, range] of Object.entries(limits)) {
      if (!finite(size[key]) || size[key] < range[0] || size[key] > range[1]) {
        throw new Error('Dimensiune invalidă pentru modelul AI: ' + key + '.');
      }
    }
    const group = new T.Group(), parts = new T.Group();
    group.name = 'photo'; parts.name = 'photo-parts'; group.add(parts);
    // Use the actual rotated geometry to locate the object's vertical midpoint.
    // Assign each complete front part to one zone, preserving doors as single pieces.
    const bounds = new T.Box3();
    const preparedParts = photo.parts.map(part => {
      const dimensions = [part.size.x * photo.size.width, part.size.y * photo.size.height, part.size.z * photo.size.depth];
      const geometry = part.shape === 'cylinder'
        ? new T.CylinderGeometry(0.5, 0.5, 1, 24, 1, false)
        : new T.BoxGeometry(1, 1, 1);
      // A cylinder's Y axis is its length; X/Z set its two diameters.
      geometry.scale(...dimensions);
      const rotation = new T.Euler(...['x', 'y', 'z'].map(axis => T.MathUtils.degToRad(part.rotation[axis])));
      geometry.applyMatrix4(new T.Matrix4().makeRotationFromEuler(rotation));
      geometry.translate(part.position.x * photo.size.width, part.position.y * photo.size.height, part.position.z * photo.size.depth);
      geometry.computeBoundingBox();
      bounds.union(geometry.boundingBox);
      return { part, geometry };
    });
    const extent = bounds.getSize(new T.Vector3());
    const center = bounds.getCenter(new T.Vector3());
    const materials = new Map(), roleCounts = {};
    for (const { part, geometry } of preparedParts) {
      const partCenterY = (geometry.boundingBox.min.y + geometry.boundingBox.max.y) / 2;
      const role = part.role === 'fronts' ? partCenterY >= center.y ? 'frontsUpper' : 'frontsLower' : part.role;
      let material = materials.get(role);
      if (!material) {
        const hardware = role === 'hardware';
        const { color, finish } = hardware ? { color: validColor(options.hardware) ? options.hardware : '#4d5148', finish: 'matte' }
          : appearance(options, photo, role);
        const params = {
          color,
          roughness: hardware ? 0.32 : finish === 'stone' ? 0.4 : 0.64,
          metalness: hardware ? 0.72 : 0.02
        };
        const map = finishTexture(T, finish);
        if (map) params.map = map;
        material = new T.MeshStandardMaterial(params);
        material.name = 'photo-material-' + role;
        material.userData = { role, finish };
        materials.set(role, material);
      }
      const mesh = new T.Mesh(geometry, material);
      roleCounts[role] = (roleCounts[role] || 0) + 1;
      mesh.name = 'photo-' + role + (roleCounts[role] > 1 ? '-' + roleCounts[role] : '');
      mesh.userData = { role, sourceRole: part.role, partName: part.name, shape: part.shape,
        ...(part.role === 'fronts' ? { frontZone: role === 'frontsUpper' ? 'upper' : 'lower' } : {}) };
      mesh.castShadow = true; mesh.receiveShadow = true;
      parts.add(mesh);
    }
    // AI coordinates may include overhangs or rotated parts. Fit actual geometry,
    // so the user's dimensions describe the entire object, not an assumed box.
    parts.position.set(-center.x, -bounds.min.y, -center.z);
    group.scale.set(size.width / extent.x, size.height / extent.y, size.depth / extent.z);
    group.userData = {
      modelType: 'photo', technique: 'ai-parts', dimensions: { ...size },
      estimatedSize: { ...photo.size }, partCount: photo.parts.length,
      depthEstimated: true, warnings: photo.warnings.slice(),
      note: 'Model 3D aproximativ din componente generate de AI. Dimensiunile și părțile ascunse sunt estimate din fotografie.'
    };
    group.updateMatrixWorld(true);
    return { group, width: size.width, height: size.height, depth: size.depth };
  }

  window.FurniturePhotoModel = { build, validateDescriptor };
})();
