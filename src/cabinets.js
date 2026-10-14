/* Parametric models. All measurements are in centimetres; the front faces +Z. */
(function () {
  'use strict';

  function workshop(settings) {
    const T = window.THREE;
    const o = Object.assign({ body: '#ede9df', fronts: '#ede9df', top: '#c5aa80', hardware: '#44423e', bodyFinish: 'matte', frontsFinish: 'matte', topFinish: 'wood', glass: true, doorsOpen: false, edgeDetails: true }, settings);
    const group = new T.Group();
    const cube = new T.BoxGeometry(1, 1, 1);
    const edgeGeometry = o.edgeDetails ? new T.EdgesGeometry(cube) : null;
    const materials = {};

    function material(role) {
      if (materials[role]) return materials[role];
      const params = { color: o[role] || o.body, roughness: 0.6, metalness: 0.02 };
      if (role === 'hardware') Object.assign(params, { roughness: 0.32, metalness: 0.72 });
      if (role === 'glass') Object.assign(params, { color: '#d9e6e4', roughness: 0.18, metalness: 0.12, transparent: true, opacity: 0.22, depthWrite: false });
      if (role === 'interior') params.color = new T.Color(o.body).multiplyScalar(0.88);
      if (role === 'edge') {
        materials[role] = new T.LineBasicMaterial({ color: '#403c34', transparent: true, opacity: 0.15 });
        return materials[role];
      }
      const finish = o[(role === 'interior' ? 'body' : role) + 'Finish'];
      if (finish === 'wood' || finish === 'stone') {
        const canvas = document.createElement('canvas');
        canvas.width = 256; canvas.height = 256;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fafaf8'; ctx.fillRect(0, 0, 256, 256);
        // Neutral textures tint cleanly with each independently selected colour.
        if (finish === 'wood') {
          for (let i = 0; i < 145; i++) {
            const y = (i * 23.77) % 256;
            ctx.strokeStyle = 'rgba(65,60,52,' + (0.035 + (i % 7) * 0.012) + ')';
            ctx.lineWidth = 0.4 + (i % 4) * 0.25;
            ctx.beginPath(); ctx.moveTo(0, y);
            ctx.bezierCurveTo(75, y + Math.sin(i) * 5, 160, y - Math.cos(i) * 4, 256, y + Math.sin(i * 3) * 2);
            ctx.stroke();
          }
        } else {
          for (let i = 0; i < 1500; i++) {
            const x = (i * 71.137) % 256, y = (i * 39.591) % 256;
            ctx.fillStyle = 'rgba(95,90,82,' + (0.015 + (i % 5) * 0.008) + ')';
            ctx.fillRect(x, y, 0.5 + i % 3, 0.5 + i % 2);
          }
          for (let i = 0; i < 4; i++) {
            ctx.strokeStyle = 'rgba(105,100,95,0.045)'; ctx.lineWidth = 0.6;
            ctx.beginPath(); ctx.moveTo(0, 30 + i * 70);
            ctx.bezierCurveTo(100, i * 31, 145, 100 + i * 30, 256, i * 66); ctx.stroke();
          }
        }
        const texture = new T.CanvasTexture(canvas);
        texture.colorSpace = T.SRGBColorSpace;
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        params.map = texture;
        params.roughness = finish === 'wood' ? 0.61 : 0.4;
      }
      materials[role] = new T.MeshStandardMaterial(params);
      return materials[role];
    }

    function box(w, h, d, x, y, z, role, parent, details) {
      const mesh = new T.Mesh(cube, material(role || 'body'));
      mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
      mesh.castShadow = role !== 'glass'; mesh.receiveShadow = true;
      (parent || group).add(mesh);
      if (edgeGeometry && details !== false && role !== 'glass' && role !== 'hardware') {
        const lines = new T.LineSegments(edgeGeometry, material('edge'));
        lines.renderOrder = 1;
        mesh.add(lines);
      }
      return mesh;
    }

    function pull(x, y, z, parent, length) {
      const h = length || 9;
      box(0.8, h, 0.8, x, y, z + 1.8, 'hardware', parent, false);
      box(0.8, 0.8, 1.8, x, y - h / 2 + 0.4, z + 0.9, 'hardware', parent, false);
      box(0.8, 0.8, 1.8, x, y + h / 2 - 0.4, z + 0.9, 'hardware', parent, false);
    }

    function framedPanel(w, h, x, y, z, parent, isGlass) {
      const border = isGlass ? 2.4 : Math.min(3.4, w / 8);
      box(w, border, 2, x, y - h / 2 + border / 2, z, 'fronts', parent);
      box(w, border, 2, x, y + h / 2 - border / 2, z, 'fronts', parent);
      box(border, h - border * 2, 2, x - w / 2 + border / 2, y, z, 'fronts', parent);
      box(border, h - border * 2, 2, x + w / 2 - border / 2, y, z, 'fronts', parent);
      box(w - border * 2, h - border * 2, isGlass ? 0.35 : 1.2, x, y, z - 0.1, isGlass ? 'glass' : 'fronts', parent);
    }

    function hingedDoor(x, y, z, w, h, hinge, isGlass) {
      const pivot = new T.Group();
      const sign = hinge === 'left' ? 1 : -1;
      pivot.position.set(x - sign * w / 2, y, z);
      group.add(pivot);
      const cx = sign * w / 2;
      framedPanel(w, h, cx, 0, 0, pivot, isGlass);
      const handleX = sign * (w - 4);
      pull(handleX, -h / 2 + 13, 1, pivot, 8);
      // Hinges are visible even with the doors shut.
      [h * -0.33, h * 0.33].forEach(yy => box(1.3, 3.3, 1, sign * 0.4, yy, 1.3, 'hardware', pivot, false));
      if (o.doorsOpen) pivot.rotation.y = sign * -1.21;
      return pivot;
    }

    return { o, group, box, pull, framedPanel, hingedDoor };
  }

  function buildCustom(options) {
    const b = workshop(options), { group, o, box, pull, framedPanel, hingedDoor } = b;
    const size = Object.assign({ width: 200, height: 215, depth: 50, counterHeight: 90, upperDepth: 30, nicheHeight: 47.5 }, o.size);
    const worktop = { width: size.width, depth: size.depth, offsetX: 0, offsetZ: 0 };
    const requestedTop = o.worktops && o.worktops.cabinet;
    for (const key of Object.keys(worktop)) {
      const raw = requestedTop && requestedTop[key];
      const value = raw == null || raw === '' ? NaN : Number(raw);
      if (Number.isFinite(value) && (key.startsWith('offset') || value > 0)) worktop[key] = value;
    }
    group.name = 'Dulap personalizat — ' + size.width + ' × ' + size.height + ' cm';
    // The width stays proportional, so wine slots, doors and the niche retain
    // their layout. Height has three independently anchored regions instead.
    group.scale.x = size.width / 200;

    // Base cabinet: a 90 cm worktop and two independently sliding leaves.
    box(196, 6, 46, 0, 3, -1, 'interior');
    box(2, 87, 50, -99, 43.5, 0);
    box(2, 87, 50, 99, 43.5, 0);
    box(196, 2, 48, 0, 7, -0.5);
    box(196, 79, 1.2, 0, 47.5, -24.4, 'interior');
    box(2, 78, 46, 0, 47, -0.5);
    box(196, 2, 46, 0, 45, -0.5);
    const countertop = box(200, 3, 50, 0, 88.5, 0, 'top');
    countertop.name = 'custom-countertop';
    box(196, 1, 3.2, 0, 8.7, 24, 'hardware');
    box(196, 1, 3.2, 0, 85.3, 24, 'hardware');
    const leaves = [
      { x: -48.7 + (o.doorsOpen ? 92.5 : 0), z: 25.4, handle: -1 },
      { x: 48.7, z: 23.7, handle: 1 }
    ];
    leaves.forEach(leaf => {
      framedPanel(97.1, 75.2, leaf.x, 47, leaf.z, group, o.glass);
      pull(leaf.x + leaf.handle * 40, 47, leaf.z + 1, group, 9);
    });

    // Keep sliding leaves, rails and the top attached to the resized base.
    const base = new window.THREE.Group();
    base.name = 'custom-base';
    group.children.slice().forEach(child => base.add(child));
    base.scale.set(1, size.counterHeight / 90, size.depth / 50);
    group.add(base);
    // These dimensions are in world centimetres. Compensate for the cabinet's
    // proportional X/Z scales so only the worktop changes, not its supports.
    countertop.scale.x = worktop.width / group.scale.x;
    countertop.scale.z = worktop.depth / base.scale.z;
    countertop.position.x = worktop.offsetX / group.scale.x;
    countertop.position.z = worktop.offsetZ / base.scale.z;

    const upperHeight = size.height - size.counterHeight - size.nicheHeight;
    const mapY = y => y <= 137.5
      ? size.counterHeight + (y - 90) * size.nicheHeight / 47.5
      : size.counterHeight + size.nicheHeight + (y - 137.5) * upperHeight / 77.5;
    // All upper parts share the rear plane of the base; their depth can vary
    // without moving that rear plane or changing the lower cabinet depth.
    const mapZ = z => -size.depth / 2 + (z + 25) * size.upperDepth / 30;
    const upperBox = (w, h, d, x, y, z, role) => {
      const low = mapY(y - h / 2), high = mapY(y + h / 2);
      return box(w, high - low, d * size.upperDepth / 30, x, (low + high) / 2, mapZ(z), role);
    };
    const upperDoor = (x, y, z, w, h, hinge, isGlass) => {
      const low = mapY(y - h / 2), high = mapY(y + h / 2);
      return hingedDoor(x, (low + high) / 2, mapZ(z), w, high - low, hinge, isGlass);
    };

    const backZ = -24.1, upperZ = -10, upperDepth = 30;
    // 120 × 47.5 cm clear niche, with a recessed structural return at its right.
    upperBox(2, 125, upperDepth, -98, 152.5, upperZ);
    upperBox(2, 47.5, upperDepth, -86, 113.75, upperZ).name = 'niche-left';
    upperBox(2, 125, upperDepth, 73, 152.5, upperZ);
    upperBox(2, 47.5, upperDepth, 36, 113.75, upperZ).name = 'niche-right';
    upperBox(35, 47.5, 1.8, 54.5, 113.75, backZ);
    upperBox(171, 1.8, upperDepth, -12.5, 138.4, upperZ);
    upperBox(173, 2, upperDepth, -12.5, 214, upperZ);
    upperBox(169, 74, 1.2, -12.5, 176.4, backZ, 'interior');
    upperBox(2, 73.6, upperDepth - 1, 14, 176.6, upperZ);
    upperBox(169, 1.8, upperDepth - 2, -12.5, 176.2, upperZ);

    // Four dividers plus the countertop and upper shelf form five clear slots.
    for (let i = 0; i < 4; i++) {
      const shelf = upperBox(10, 1.25, upperDepth, -92, 99.125 + i * 9.75, upperZ);
      shelf.name = 'wine-divider-' + (i + 1);
    }
    upperBox(10, 46, 1.2, -92, 113.5, backZ, 'interior');

    // Two upper glazed leaves and a two-level open bay on the right.
    upperDoor(-69.8, 176.6, 5.7, 53.4, 73.0, 'left', o.glass);
    upperDoor(-15.5, 176.6, 5.7, 53.4, 73.0, 'right', o.glass);

    // Seven right-facing shelves have no outside end panel.
    for (let i = 0; i < 7; i++) {
      // These span the whole upper assembly, independently of the niche split.
      const upperScale = (size.height - size.counterHeight) / 125;
      const shelf = box(25, 1.8 * upperScale, 29 * size.upperDepth / 30, 86.5,
        size.counterHeight + (1.2 + i * 17.6) * upperScale, mapZ(-10.2));
      shelf.name = 'side-shelf-' + (i + 1);
    }
    const bounds = {
      minX: Math.min(-size.width / 2, worktop.offsetX - worktop.width / 2),
      maxX: Math.max(size.width / 2, worktop.offsetX + worktop.width / 2),
      minZ: Math.min(-size.depth / 2, worktop.offsetZ - worktop.depth / 2),
      maxZ: Math.max(size.depth / 2, -size.depth / 2 + size.upperDepth, worktop.offsetZ + worktop.depth / 2)
    };
    const overallWidth = bounds.maxX - bounds.minX, overallDepth = bounds.maxZ - bounds.minZ;
    group.userData = {
      model: 'custom', nominalSize: [size.width, size.height, size.depth],
      dimensionsCm: Object.assign({}, size), niche: [120 * size.width / 200, size.nicheHeight],
      wineCompartments: 5, sideShelves: 7,
      worktops: { cabinet: worktop }, bounds,
      bodyDimensionsCm: Object.assign({}, size),
      overallDimensionsCm: { width: overallWidth, height: size.height, depth: overallDepth }
    };
    return { group, width: overallWidth, height: size.height, depth: overallDepth, bounds };
  }

  window.FurnitureCabinets = { buildCustom };
})();
