const assert = require('node:assert/strict');
const { schema, validateDescriptor } = require('./src/ai-schema.js');
const THREE = require('./vendor/three.min.js');

// Geometry tests need no browser, network, GPU or provider credentials.
global.window = { THREE };
global.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return { width: 0, height: 0, getContext: () => ({
      fillRect() {}, beginPath() {}, moveTo() {}, bezierCurveTo() {}, stroke() {}
    }) };
  }
};
require('./src/photo-model.js');
const { build, validateDescriptor: validateModel } = window.FurniturePhotoModel;
const clone = value => JSON.parse(JSON.stringify(value));
const part = (name, role, position, size, shape = 'box', rotation = { x: 0, y: 0, z: 0 }) =>
  ({ name, role, shape, position, size, rotation });
const fixture = {
  version: 2, name: 'Masă cu sertar', kind: 'furniture', reason: '',
  size: { width: 120, height: 80, depth: 60 },
  colors: { body: '#324456', fronts: '#718293', top: '#AB8951' },
  warnings: ['Dimensiuni estimate dintr-o singură imagine.'],
  parts: [
    part('Blat', 'top', { x: 0, y: 0.975, z: 0 }, { x: 1, y: 0.05, z: 1 }),
    ...[-0.45, 0.45].flatMap(x => [-0.45, 0.45].map(z =>
      part('Picior', 'body', { x, y: 0.475, z }, { x: 0.06, y: 0.95, z: 0.06 }))),
    part('Sertar', 'fronts', { x: 0, y: 0.84, z: 0.45 }, { x: 0.75, y: 0.15, z: 0.04 }),
    part('Mâner', 'hardware', { x: 0, y: 0.84, z: 0.48 }, { x: 0.012, y: 0.14, z: 0.012 }, 'cylinder', { x: 0, y: 0, z: 90 })
  ]
};
const clean = validateDescriptor(fixture);
assert.equal(clean.colors.top, '#ab8951');
clean.parts[0].position.x = 0.2;
assert.equal(fixture.parts[0].position.x, 0, 'Validator clones nested objects');
assert.equal(schema.additionalProperties, false);
assert.equal(schema.properties.parts.maxItems, 100);
assert.equal(schema.properties.parts.items.additionalProperties, false);
assert.deepEqual(schema.required, Object.keys(schema.properties));

const invalidMutations = [
  v => { v.version = 1; },
  v => { v.kind = 'execute'; },
  v => { v.name = ' '; },
  v => { v.name = 'n'.repeat(81); },
  v => { v.reason = 'r'.repeat(241); },
  v => { v.code = 'alert(document.cookie)'; },
  v => { delete v.reason; },
  v => { v.size.width = Infinity; },
  v => { v.size.depth = 0; },
  v => { v.size.height = 301; },
  v => { v.colors.body = 'url(https://invalid.example)'; },
  v => { v.colors.apiKey = 'secret'; },
  v => { v.warnings = Array(9).fill('warning'); },
  v => { v.warnings = Array(1); },
  v => { v.parts = []; },
  v => { v.parts = Array(101).fill(v.parts[0]); },
  v => { v.parts = Array(2); },
  v => { v.parts[0].name = {}; },
  v => { v.parts[0].shape = 'javascript'; },
  v => { v.parts[0].role = 'image'; },
  v => { v.parts[0].position.x = NaN; },
  v => { v.parts[0].position.y = -0.1; },
  v => { v.parts[0].position.z = 2; },
  v => { v.parts[0].size.y = 0; },
  v => { v.parts[0].size.x = 3; },
  v => { v.parts[0].rotation.z = 181; },
  v => { v.parts[0].rotation.x = '90'; },
  v => { v.parts[0].assetUrl = 'https://invalid.example/model.glb'; },
  v => { v.parts[0].size = null; },
  v => { v.parts[0].position.extra = 1; },
  v => { v.kind = 'unsupported'; }
];
for (const mutate of invalidMutations) {
  const value = clone(fixture); mutate(value);
  assert.throws(() => validateDescriptor(value), /invalide/, mutate.toString());
}
assert.throws(() => validateDescriptor('alert(1)'));
assert.throws(() => validateDescriptor(JSON.parse(JSON.stringify(fixture).replace('"version":2', '"version":2,"__proto__":{"polluted":true}'))));
assert.equal({}.polluted, undefined);
const inherited = clone(fixture);
delete inherited.name; Object.setPrototypeOf(inherited, { name: 'Inherited' });
assert.throws(() => validateDescriptor(inherited));
const unsupported = { ...clone(fixture), kind: 'unsupported', reason: 'Imaginea nu conține mobilier.', parts: [] };
assert.equal(validateDescriptor(unsupported).kind, 'unsupported');
assert.throws(() => validateModel(unsupported), /Imaginea nu conține mobilier/);

function meshes(group) {
  const result = [];
  group.traverse(node => { if (node.isMesh) result.push(node); });
  return result;
}
function assertDimensions(group, size) {
  group.updateMatrixWorld(true);
  // The ordinary bounding-box path used by the app must also remain exact for
  // angled panels and cylinders, not only the slower per-vertex path.
  const bounds = new THREE.Box3().setFromObject(group);
  const extent = bounds.getSize(new THREE.Vector3());
  for (const [axis, key] of [['x', 'width'], ['y', 'height'], ['z', 'depth']]) {
    assert(Math.abs(extent[axis] - size[key]) < 1e-6, `${key}: ${extent[axis]} versus ${size[key]}`);
  }
  assert(Math.abs(bounds.min.y) < 1e-6, 'Object rests on floor');
  assert(Math.abs(bounds.min.x + bounds.max.x) < 1e-6, 'Object centered horizontally');
  assert(Math.abs(bounds.min.z + bounds.max.z) < 1e-6, 'Object centered in depth');
}
const first = build({ photo: fixture });
assertDimensions(first.group, fixture.size);
assert.deepEqual([first.width, first.height, first.depth], [120, 80, 60]);
assert.equal(first.group.userData.technique, 'ai-parts');
assert.equal(first.group.userData.partCount, 7);
assert.equal(meshes(first.group).length, 7);
assert.equal(new Set(meshes(first.group).map(mesh => mesh.material)).size, 4, 'One shared material per role');
assert(meshes(first.group).every(mesh => mesh.castShadow && mesh.receiveShadow));
const ray = new THREE.Raycaster(new THREE.Vector3(0, 20, 500), new THREE.Vector3(0, 0, -1));
assert.equal(ray.intersectObject(first.group, true).length, 0, 'Space between table legs is open geometry');
const handle = first.group.getObjectByName('photo-hardware');
assert.equal(handle.geometry.type, 'CylinderGeometry');
assert.equal(handle.geometry.parameters.openEnded, false, 'Cylinder has solid end caps');
const scaledSize = { width: 197, height: 93, depth: 77 };
const edited = build({ photo: fixture, size: scaledSize, body: '#123456', fronts: '#654321', top: '#abcdef', bodyFinish: 'wood', frontsFinish: 'matte', topFinish: 'stone' });
assertDimensions(edited.group, scaledSize);
for (const [role, hex, textured] of [['body', '123456', true], ['fronts', '654321', false], ['top', 'abcdef', true]]) {
  const roleMeshes = meshes(edited.group).filter(mesh => mesh.userData.role === role);
  assert(roleMeshes.length);
  assert(roleMeshes.every(mesh => mesh.material.color.getHexString() === hex));
  assert(roleMeshes.every(mesh => Boolean(mesh.material.map) === textured));
}
assert.equal(edited.group.getObjectByName('photo-hardware').material.map, null);
const rotated = clone(fixture);
rotated.parts[0].rotation = { x: 24, y: -37, z: 15 };
rotated.parts[0].position = { x: 0.8, y: 1.5, z: -0.7 };
assertDimensions(build({ photo: rotated, size: scaledSize }).group, scaledSize);
assert.throws(() => build({ photo: fixture, size: { width: 999 } }), /Dimensiune invalidă/);
assert.throws(() => build({ photo: fixture, size: { height: NaN } }), /Dimensiune invalidă/);

// Previously exported local silhouettes remain editable after switching to AI.
const legacy = {
  version: 1, grid: { width: 2, height: 2, mask: [1, 1, 1, 0] }, aspect: 1,
  colors: fixture.colors, confidence: 'limited', warnings: [],
  bounds: { x: 0, y: 0, width: 1, height: 1 }, sourceWidth: 100, sourceHeight: 100
};
assert.equal(validateModel(legacy).version, 1);
assertDimensions(build({ photo: legacy, size: scaledSize }).group, scaledSize);
console.log(JSON.stringify({ passed: true, rejectedMalformedModels: invalidMutations.length + 3, independentMaterials: true, editableDimensions: true, closedPrimitives: true, openLegSpace: true, rotatedBounds: true, legacyProjects: true }, null, 2));
