(function () {
  'use strict';

  const T = window.THREE;
  const grainCache = new Map();

  function woodTexture() {
    if (grainCache.has('oak')) return grainCache.get('oak');
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#e5e1d8'; ctx.fillRect(0, 0, 512, 256);
    let seed = 7319;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 360; i++) {
      const y = rand() * 256, wave = 0.7 + rand() * 3;
      ctx.strokeStyle = `rgba(90,76,53,${0.025 + rand() * 0.11})`;
      ctx.lineWidth = 0.35 + rand() * 1.3;
      ctx.beginPath();
      for (let x = 0; x <= 512; x += 8) {
        const yy = y + Math.sin(x / 85 + y * 0.17) * wave + Math.sin(x / 170 + i) * 1.5;
        if (x === 0) ctx.moveTo(x, yy); else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.anisotropy = 4;
    grainCache.set('oak', texture);
    return texture;
  }

  function stoneTexture() {
    if (grainCache.has('stone')) return grainCache.get('stone');
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#f9f8f5'; ctx.fillRect(0, 0, 256, 256);
    let seed = 517;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 6500; i++) {
      const shade = 120 + Math.floor(rand() * 100);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},${0.025 + rand() * 0.11})`;
      const size = 0.2 + rand() * 1.1; ctx.fillRect(rand() * 256, rand() * 256, size, size);
    }
    for (let i = 0; i < 9; i++) {
      ctx.strokeStyle = 'rgba(153,148,138,0.065)'; ctx.lineWidth = 0.35 + rand() * 0.5;
      ctx.beginPath(); const y = rand() * 256; ctx.moveTo(0, y);
      ctx.bezierCurveTo(80, y + 36, 140, y - 37, 256, y + 12); ctx.stroke();
    }
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace;
    texture.wrapS = texture.wrapT = T.RepeatWrapping; texture.anisotropy = 4;
    grainCache.set('stone', texture); return texture;
  }

  function context(options) {
    const o = Object.assign({ body: '#e6e5de', fronts: '#ecece7', top: '#d5b685', hardware: '#666963', bodyFinish: 'matte', frontsFinish: 'matte', topFinish: 'wood', extension: 1, doorsOpen: false, edgeDetails: true }, options || {});
    o.extension = Math.max(0, Math.min(1, Number(o.extension) || 0));
    const finishMaterial = (color, finish) => new T.MeshStandardMaterial({
      color, map: finish === 'wood' ? woodTexture() : finish === 'stone' ? stoneTexture() : null,
      roughness: finish === 'stone' ? 0.35 : finish === 'wood' ? 0.58 : 0.65,
    });
    const mat = {
      body: finishMaterial(o.body, o.bodyFinish),
      front: finishMaterial(o.fronts, o.frontsFinish),
      top: finishMaterial(o.top, o.topFinish),
      metal: new T.MeshStandardMaterial({ color: o.hardware, metalness: 0.72, roughness: 0.27 }),
      dark: new T.MeshStandardMaterial({ color: '#252724', roughness: 0.8 }),
      drawer: new T.MeshStandardMaterial({ color: '#cfbd9f', roughness: 0.78 }),
      slot: new T.MeshStandardMaterial({ color: '#393c36', roughness: 0.9 }),
    };
    const edges = new T.LineBasicMaterial({ color: new T.Color(o.body).multiplyScalar(0.52), transparent: true, opacity: 0.22 });
    function box(parent, w, h, d, x, y, z, material = mat.body, outline = false) {
      const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
      parent.add(mesh);
      if (outline && o.edgeDetails) {
        const line = new T.LineSegments(new T.EdgesGeometry(mesh.geometry), edges);
        mesh.add(line);
      }
      return mesh;
    }
    function cylinder(parent, radius, length, x, y, z, material, axis = 'z', radialSegments = 14) {
      const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, length, radialSegments), material);
      if (axis === 'z') mesh.rotation.x = Math.PI / 2;
      if (axis === 'x') mesh.rotation.z = Math.PI / 2;
      mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      return mesh;
    }
    function knob(parent, x, y, z, face = 1) {
      cylinder(parent, 0.48, 1.25, x, y, z + face * 0.5, mat.metal);
      const sphere = new T.Mesh(new T.SphereGeometry(1.06, 16, 12), mat.metal);
      sphere.scale.z = 0.68; sphere.position.set(x, y, z + face * 1.25); sphere.castShadow = true; parent.add(sphere);
      cylinder(parent, 0.83, 0.16, x, y, z, mat.metal);
    }
    function panel(parent, width, height, x, y, z, face = 1) {
      const group = new T.Group(); group.position.set(x, y, z); parent.add(group);
      box(group, width, height, 1.5, 0, 0, 0, mat.front, true);
      const frame = Math.min(3.2, width * 0.14, height * 0.16);
      const frontZ = face * 1.04;
      box(group, frame, height, 0.7, -width / 2 + frame / 2, 0, frontZ, mat.front, true);
      box(group, frame, height, 0.7, width / 2 - frame / 2, 0, frontZ, mat.front, true);
      box(group, width - frame * 2, frame, 0.7, 0, height / 2 - frame / 2, frontZ, mat.front, true);
      box(group, width - frame * 2, frame, 0.7, 0, -height / 2 + frame / 2, frontZ, mat.front, true);
      if (o.edgeDetails && width > 15 && height > 15) {
        const lineColor = new T.Color(o.fronts).multiplyScalar(0.68);
        const inner = new T.LineBasicMaterial({ color: lineColor, transparent: true, opacity: 0.25 });
        const iw = width / 2 - frame - 0.4, ih = height / 2 - frame - 0.4;
        const points = [[-iw, -ih], [iw, -ih], [iw, ih], [-iw, ih], [-iw, -ih]].map(([xx, yy]) => new T.Vector3(xx, yy, face * 0.79));
        group.add(new T.Line(new T.BufferGeometry().setFromPoints(points), inner));
      }
      return group;
    }
    function hingedDoor(parent, width, height, hingeX, centerY, z, direction, face = 1) {
      const pivot = new T.Group(); pivot.position.set(hingeX, centerY, z); parent.add(pivot);
      const door = panel(pivot, width, height, direction * width / 2, 0, 0, face);
      knob(door, direction * (width / 2 - 4.4), height * 0.32, face * 1.48, face);
      for (const hingeY of [-height * 0.31, height * 0.31]) {
        cylinder(pivot, 0.42, 4.0, 0, hingeY, face * 0.6, mat.metal, 'y');
        if (o.doorsOpen) box(pivot, 3.2, 2, 0.22, direction * 1.4, hingeY, -face * 0.9, mat.metal);
      }
      if (o.doorsOpen) pivot.rotation.y = -direction * face * 1.78;
      return pivot;
    }
    function drawer(parent, width, height, depth, x, y, z, face = 1, twoKnobs = false) {
      panel(parent, width, height, x, y, z, face);
      if (twoKnobs) { knob(parent, x - width * 0.28, y, z + face * 1.48, face); knob(parent, x + width * 0.28, y, z + face * 1.48, face); }
      else knob(parent, x, y, z + face * 1.48, face);
      box(parent, width - 3, 0.8, depth, x, y - height / 2 + 1.4, z - face * (depth / 2 + 1), mat.drawer);
      box(parent, 0.9, height - 3, depth, x - width / 2 + 1.5, y, z - face * (depth / 2 + 1), mat.drawer);
      box(parent, 0.9, height - 3, depth, x + width / 2 - 1.5, y, z - face * (depth / 2 + 1), mat.drawer);
      box(parent, width - 3, height - 3, 0.9, x, y, z - face * (depth + 1), mat.drawer);
    }
    function pegRows(parent, x, zValues, minY, maxY, step = 4) {
      if (!o.edgeDetails) return;
      for (const z of zValues) for (let y = minY; y <= maxY; y += step) cylinder(parent, 0.23, 0.07, x, y, z, mat.dark, 'x', 8);
    }
    function shelfPegs(parent, left, right, zValues, y) {
      if (!o.edgeDetails) return;
      for (const x of [left, right]) for (const z of zValues) cylinder(parent, 0.3, 0.8, x, y - 1.2, z, mat.metal, 'x', 8);
    }
    return { o, mat, box, cylinder, knob, panel, hingedDoor, drawer, pegRows, shelfPegs };
  }

  function buildBar(options) {
    const c = context(options), { o, mat, box, drawer, hingedDoor, pegRows, shelfPegs } = c;
    const defaults = { width: 80, height: 110, depth: 90, tableLength: 110, tableHeight: 76, tableDepth: 90 };
    const limits = { width: [50, 160], height: [90, 140], depth: [50, 130], tableLength: [40, 180], tableHeight: [60, 100], tableDepth: [40, 130] };
    const size = Object.assign({}, defaults);
    for (const key of Object.keys(defaults)) {
      const rawValue = o.size && o.size[key];
      const value = rawValue == null || rawValue === '' ? NaN : Number(rawValue);
      if (Number.isFinite(value)) size[key] = Math.max(limits[key][0], Math.min(limits[key][1], value));
    }
    size.tableHeight = Math.min(size.tableHeight, size.height - 25);
    size.tableDepth = Math.min(size.tableDepth, size.depth);
    const { width, height, depth, tableHeight, tableDepth } = size;
    const extension = 30 + (size.tableLength - 30) * o.extension;
    const worktops = {
      bar: { width, depth: depth + 20, offsetX: 0, offsetZ: 0 },
      table: { width: extension + 0.5, depth: tableDepth, offsetX: 0, offsetZ: 0 }
    };
    for (const role of Object.keys(worktops)) {
      const requestedTop = o.worktops && o.worktops[role];
      for (const key of Object.keys(worktops[role])) {
        const raw = requestedTop && requestedTop[key];
        const value = raw == null || raw === '' ? NaN : Number(raw);
        if (Number.isFinite(value) && (key.startsWith('offset') || value > 0)) worktops[role][key] = value;
      }
    }
    const left = -width / 2, right = width / 2;
    const sideBottom = 7.4, sideTop = height - 3;
    const slotBottom = tableHeight - 3.7, slotTop = tableHeight + 0.7;
    const sideHeight = sideTop - sideBottom, sideY = (sideTop + sideBottom) / 2;
    const pegZ = depth / 2 - 11;
    const group = new T.Group(); group.name = 'Insulă cu bar și masă extensibilă';
    const cabinet = new T.Group(); cabinet.position.x = extension / 2; group.add(cabinet);

    // Worktops have independent dimensions; the supporting cabinet is unchanged.
    box(cabinet, width - 4, 5.4, depth - 5, 0, 2.7, 0, mat.body, true);
    box(cabinet, width, 2, depth, 0, 6.4, 0, mat.body, true);
    // The table slot follows both the independent table height and its depth.
    box(cabinet, 2, slotBottom - sideBottom, depth, left + 1, (slotBottom + sideBottom) / 2, 0, mat.body, true).name = 'bar-left-side-lower';
    box(cabinet, 2, sideTop - slotTop, depth, left + 1, (sideTop + slotTop) / 2, 0, mat.body, true).name = 'bar-left-side-upper';
    const slotDepth = Math.min(depth, tableDepth + 0.8);
    const slotEdgeDepth = (depth - slotDepth) / 2;
    if (slotEdgeDepth > 0) {
      for (const face of [1, -1]) box(cabinet, 2, slotTop - slotBottom, slotEdgeDepth, left + 1, (slotTop + slotBottom) / 2, face * (slotDepth + slotEdgeDepth) / 2, mat.body, true);
    }
    box(cabinet, 1.4, sideHeight, depth, right - 1.3, sideY, 0, mat.body, true).name = 'bar-right-side';
    box(cabinet, width - 4, 1.8, depth - 3, 0, height - 19.5, 0, mat.body, true);
    box(cabinet, width - 4, 1.8, depth - 2, 0, height - 4.2, 0, mat.body, true);
    const barTop = worktops.bar;
    box(cabinet, barTop.width, 3, barTop.depth, barTop.offsetX, height - 1.5, barTop.offsetZ, mat.top, true).name = 'bar-countertop';

    const shelfScale = (height - 27.8) / 82.2;
    for (const offset of [19.6, 40.6, 61.6]) {
      const y = sideBottom + offset * shelfScale;
      box(cabinet, width - 4.4, 1.8, depth - 4.4, 0, y, 0, mat.body, true);
      shelfPegs(cabinet, left + 2.3, right - 2.3, [-pegZ, pegZ], y);
    }
    pegRows(cabinet, left + 2.04, [-pegZ, pegZ], 15, height - 26);
    pegRows(cabinet, right - 2.04, [-pegZ, pegZ], 15, height - 26);

    // The drawer bay stays above the table, with independent drawers on both faces.
    for (const face of [1, -1]) {
      const z = face * (depth / 2 + 0.6);
      box(cabinet, 2.4, height - 27, 2.6, left + 1.8, height / 2 - 6.5, face * (depth / 2 - 0.4), mat.body, true);
      box(cabinet, 2.4, height - 27, 2.6, right - 1.8, height / 2 - 6.5, face * (depth / 2 - 0.4), mat.body, true);
      box(cabinet, width - 4, 2, 2.6, 0, height - 20.4, face * (depth / 2 - 0.4), mat.body, true);
      hingedDoor(cabinet, width / 2 - 2.8, height - 29.2, left + 2.4, height / 2 - 6.7, z, 1, face);
      hingedDoor(cabinet, width / 2 - 2.8, height - 29.2, right - 2.4, height / 2 - 6.7, z, -1, face);
      drawer(cabinet, width - 4.8, 12.8, (depth - 12) / 2, 0, height - 11.5, z, face, true);
    }
    for (const z of [-depth / 2 + 1.6, depth / 2 - 1.6]) box(cabinet, 0.6, sideHeight, 3.2, right - 0.3, sideY, z, mat.body, true);
    for (const y of [9, height - 4.6]) box(cabinet, 0.6, 3.2, depth - 6.4, right - 0.3, y, 0, mat.body, true);
    for (const y of [tableHeight - 3.5, tableHeight + 0.5]) box(cabinet, 2, 0.2, tableDepth - 2, left + 1, y, 0, mat.slot);

    const outside = left - extension;
    const tableTop = worktops.table;
    const tableCenterX = left - extension / 2 + 0.25;
    box(cabinet, tableTop.width, 3, tableTop.depth, tableCenterX + tableTop.offsetX, tableHeight - 1.5, tableTop.offsetZ, mat.top, true).name = 'bar-tabletop';
    // Slim telescopic guides under the tabletop, visible at full extension.
    for (const z of [-tableDepth / 2 + 14, tableDepth / 2 - 14]) {
      box(cabinet, Math.max(10, extension - 17), 2.0, 1.1, left - (extension - 17) / 2, tableHeight - 4.7, z, mat.metal);
      box(cabinet, Math.max(8, extension * 0.54), 1.2, 0.8, left - extension * 0.27, tableHeight - 5.5, z, mat.metal);
    }
    // Open support cabinet with two adjustable shelves and a bottom shelf.
    const supportW = 20, supportD = tableDepth - 4;
    const supportX = outside + supportW / 2 + 0.5;
    const supportPegZ = supportD / 2 - 11;
    box(cabinet, supportW, 2, supportD, supportX, 1.2, 0, mat.body, true);
    box(cabinet, 1.8, tableHeight - 5.2, supportD, outside + 1.4, tableHeight / 2 - 0.6, 0, mat.body, true);
    box(cabinet, 1.8, tableHeight - 5.2, supportD, outside + supportW - 0.4, tableHeight / 2 - 0.6, 0, mat.body, true);
    box(cabinet, supportW, 2, supportD, supportX, tableHeight - 4.1, 0, mat.body, true);
    for (const offset of [21.8, 44.8]) {
      const y = 2.2 + offset * (tableHeight - 7.3) / 68.7;
      box(cabinet, supportW - 3.6, 1.8, supportD - 0.8, supportX, y, 0, mat.body, true);
      shelfPegs(cabinet, outside + 2.5, outside + supportW - 1.5, [-supportPegZ, supportPegZ], y);
    }
    pegRows(cabinet, outside + 2.34, [-supportPegZ, supportPegZ], 9, tableHeight - 11, 4);
    pegRows(cabinet, outside + supportW - 1.34, [-supportPegZ, supportPegZ], 9, tableHeight - 11, 4);
    // Measure the tops together with the nominal cabinet/support outline;
    // decorative hardware and opened doors do not change these dimensions.
    const barCenterX = cabinet.position.x + barTop.offsetX;
    const tableWorldX = cabinet.position.x + tableCenterX + tableTop.offsetX;
    const bounds = {
      minX: Math.min(-(width + extension) / 2, barCenterX - barTop.width / 2, tableWorldX - tableTop.width / 2),
      maxX: Math.max((width + extension) / 2, barCenterX + barTop.width / 2, tableWorldX + tableTop.width / 2),
      minZ: Math.min(-depth / 2, barTop.offsetZ - barTop.depth / 2, tableTop.offsetZ - tableTop.depth / 2),
      maxZ: Math.max(depth / 2, barTop.offsetZ + barTop.depth / 2, tableTop.offsetZ + tableTop.depth / 2)
    };
    const overallWidth = bounds.maxX - bounds.minX, overallDepth = bounds.maxZ - bounds.minZ;
    group.userData = {
      model: 'bar', extensionCm: extension,
      dimensionsCm: { width: overallWidth, height, depth: overallDepth },
      tableHeight, tableDepth, sizeCm: size, worktops, bounds,
      bodyDimensionsCm: Object.assign({}, size),
      overallDimensionsCm: { width: overallWidth, height, depth: overallDepth }
    };
    return { group, width: overallWidth, height, depth: overallDepth, bounds };
  }

  window.FurnitureIslands = { buildBar };
})();
