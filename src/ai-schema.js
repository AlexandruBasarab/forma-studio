/* Shared, data-only contract for AI furniture models. Works in browsers,
 * Cloudflare Workers and Node through a side-effect import. No generated code
 * or arbitrary asset URLs are accepted by this contract.
 */
(function () {
  'use strict';

  const ROLES = ['body', 'fronts', 'top', 'hardware'];
  const LIMITS = { width: [20, 400], height: [20, 300], depth: [10, 180] };
  const number = (minimum, maximum) => ({ type: 'number', minimum, maximum });
  const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
  const color = { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' };
  const schema = object({
    version: { type: 'integer', enum: [2] },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    kind: { type: 'string', enum: ['furniture', 'unsupported'] },
    reason: { type: 'string', maxLength: 240 },
    size: object(Object.fromEntries(Object.entries(LIMITS).map(([key, limits]) => [key, number(...limits)]))),
    colors: object({ body: color, fronts: color, top: color }),
    warnings: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
    parts: {
      type: 'array', maxItems: 100,
      items: object({
        name: { type: 'string', minLength: 1, maxLength: 80 },
        shape: { type: 'string', enum: ['box', 'cylinder'] },
        role: { type: 'string', enum: ROLES },
        position: object({ x: number(-1, 1), y: number(0, 2), z: number(-1, 1) }),
        size: object({ x: number(0.001, 2), y: number(0.001, 2), z: number(0.001, 2) }),
        rotation: object({ x: number(-180, 180), y: number(-180, 180), z: number(-180, 180) })
      })
    }
  });

  function fail(path) {
    throw new Error('Modelul AI conține date invalide: ' + path + '.');
  }

  // Validate before allocating geometry. Requiring own properties and rejecting
  // unknown fields also prevents a response from smuggling code, URLs or keys.
  function record(value, keys, path) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        !keys.every(key => Object.prototype.hasOwnProperty.call(value, key))) fail(path);
  }

  function bounded(value, min, max, path) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(path);
    return value;
  }

  function label(value, max, path, required) {
    if (typeof value !== 'string' || value.length > max) fail(path);
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    if (required && !cleaned) fail(path);
    return cleaned;
  }

  function vector(value, limits, path) {
    record(value, ['x', 'y', 'z'], path);
    return Object.fromEntries(['x', 'y', 'z'].map(axis =>
      [axis, bounded(value[axis], ...limits[axis], path + '.' + axis)]));
  }

  function validateDescriptor(value) {
    record(value, ['version', 'name', 'kind', 'reason', 'size', 'colors', 'warnings', 'parts'], 'obiect');
    if (value.version !== 2 || !['furniture', 'unsupported'].includes(value.kind)) fail('versiune / tip');
    const name = label(value.name, 80, 'nume', true);
    const reason = label(value.reason, 240, 'explicație');
    record(value.size, ['width', 'height', 'depth'], 'dimensiuni');
    const size = Object.fromEntries(Object.entries(LIMITS).map(([key, limits]) =>
      [key, bounded(value.size[key], ...limits, 'dimensiuni.' + key)]));
    record(value.colors, ['body', 'fronts', 'top'], 'culori');
    const colors = Object.fromEntries(['body', 'fronts', 'top'].map(role => {
      if (typeof value.colors[role] !== 'string' || !/^#[0-9a-f]{6}$/i.test(value.colors[role])) fail('culori.' + role);
      return [role, value.colors[role].toLowerCase()];
    }));
    if (!Array.isArray(value.warnings) || value.warnings.length > 8) fail('observații');
    const warnings = Array.from(value.warnings, (item, index) => label(item, 240, 'observații.' + index));
    if (!Array.isArray(value.parts) || value.parts.length > 100 ||
        (value.kind === 'furniture' && value.parts.length === 0) ||
        (value.kind === 'unsupported' && value.parts.length !== 0)) fail('componente');
    const parts = Array.from(value.parts, (part, index) => {
      const path = 'componente.' + index;
      record(part, ['name', 'shape', 'role', 'position', 'size', 'rotation'], path);
      if (!['box', 'cylinder'].includes(part.shape) || !ROLES.includes(part.role)) fail(path + '.tip / material');
      return {
        name: label(part.name, 80, path + '.nume', true), shape: part.shape, role: part.role,
        position: vector(part.position, { x: [-1, 1], y: [0, 2], z: [-1, 1] }, path + '.poziție'),
        size: vector(part.size, { x: [0.001, 2], y: [0.001, 2], z: [0.001, 2] }, path + '.dimensiuni'),
        rotation: vector(part.rotation, { x: [-180, 180], y: [-180, 180], z: [-180, 180] }, path + '.rotație')
      };
    });
    return { version: 2, name, kind: value.kind, reason, size, colors, warnings, parts };
  }

  globalThis.FurnitureAI = { schema, validateDescriptor };
  if (typeof module === 'object' && module.exports) module.exports = globalThis.FurnitureAI;
})();
