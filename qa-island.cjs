const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QA = path.join(__dirname, 'qa');
const FILE = path.join(__dirname, 'configurator-mobilier.html');
const BASE = 'https://forma.example/configurator/';
const DEFAULT_ISLAND = { width: 80, height: 90, depth: 90, tableLength: 110, tableHeight: 76, tableDepth: 90, tableRetraction: 70 };
const ROLES = ['top', 'frontsUpper', 'frontsLower', 'body'];
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = link => JSON.parse(Buffer.from(new URL(link).searchParams.get('config'), 'base64url').toString());
const linkFor = payload => { const url = new URL(BASE); url.searchParams.set('config', encode(payload)); return url.href; };
const closeTo = (actual, expected, label, tolerance = 0.03) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} should equal ${expected}`);
const clone = value => JSON.parse(JSON.stringify(value));

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  let page;
  try {
    async function context() {
      const result = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      await result.setOffline(true);
      await result.route(BASE + '**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FILE) }));
      return result;
    }
    const main = await context(); page = await main.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const ready = p => p.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = (p = page) => p.evaluate(() => FormaConfigurator.getState());
    const metrics = () => page.evaluate(() => FormaConfigurator.getMetrics());
    async function input(selector, value) {
      await page.fill(selector, String(value)); await page.locator(selector).press('Tab'); await settle(page);
    }
    async function choose(variant) {
      await page.click(`[data-bar-variant="${variant}"]`); await settle(page);
      assert.equal((await state()).barVariant, variant);
      assert.equal(await page.locator(`[data-bar-variant="${variant}"]`).getAttribute('aria-pressed'), 'true');
    }
    async function dimensions(values) {
      await page.locator('#size-details').evaluate(el => { el.open = true; });
      for (const [field, value] of Object.entries(values)) await input('#size-' + field, value);
    }
    async function extend(percent) {
      await page.locator('#extension').evaluate((el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }, percent); await settle(page);
    }
    async function editTop(key, values) {
      await page.selectOption('#worktopSelect', key);
      for (const [field, value] of Object.entries(values)) await input('#worktop-' + field, value);
    }
    async function meshBox(name) {
      return page.evaluate(name => {
        const scene = FormaConfigurator.getScene(); scene.updateMatrixWorld(true);
        const mesh = scene.getObjectByName(name); if (!mesh) throw new Error('Missing geometry: ' + name);
        const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3());
        return { min: box.min.toArray(), max: box.max.toArray(), width: size.x, height: size.y, depth: size.z, center: box.getCenter(new THREE.Vector3()).toArray(), rotation: mesh.rotation.toArray().slice(0, 3) };
      }, name);
    }
    async function snapshot(p = page, excludeTops = false) {
      return p.evaluate(excludeTops => {
        const scene = FormaConfigurator.getScene(); scene.updateMatrixWorld(true);
        const root = scene.getObjectByName('bar'), meshes = [];
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          if (excludeTops) for (let item = mesh; item; item = item.parent) if (['island-countertop', 'island-tabletop'].includes(item.name)) return;
          const box = new THREE.Box3().setFromObject(mesh);
          meshes.push({ name: mesh.name, matrix: mesh.matrixWorld.toArray(), min: box.min.toArray(), max: box.max.toArray(), role: mesh.userData.role, color: mesh.material.color.getHexString(), finish: mesh.material.userData.finish });
        });
        return meshes;
      }, excludeTops);
    }
    async function metadata() { return page.evaluate(() => FormaConfigurator.getScene().getObjectByName('bar').userData); }
    async function share() {
      await page.click('#shareAppearanceBtn'); const link = await page.inputValue('#appearanceShareUrl');
      await page.click('#closeAppearanceShare'); return link;
    }
    async function importProject(configuration, version = 6) {
      await page.setInputFiles('#projectFile', { name: 'island-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'forma-furniture', version, configuration })) });
      await settle(page);
    }

    await page.goto(BASE); await ready(page);
    assert(await page.locator('#barVariantControl').isHidden(), 'The variant picker belongs to the bar/table object');
    await page.click('[data-model="bar"]'); await settle(page);
    assert(await page.locator('#barVariantControl').isVisible());
    assert.equal((await state()).barVariant, 'bar', 'Existing visits default to the original bar');
    const originalBarState = await state(), originalBarGeometry = await snapshot(), originalBarMetrics = await metrics();
    await choose('island');
    assert.deepEqual((await state()).sizes.island, DEFAULT_ISLAND);
    assert.equal(await page.inputValue('#size-height'), '90');
    assert.equal(await page.inputValue('#size-tableRetraction'), '70');
    assert.deepEqual(await page.locator('#worktopSelect option').evaluateAll(options => options.map(option => option.value)), ['island', 'islandTable']);
    closeTo((await meshBox('island-countertop')).width, 82, 'Island top has one centimeter on each side');
    closeTo((await meshBox('island-countertop')).depth, 92, 'Island countertop depth');
    closeTo((await meshBox('island-countertop')).center[2], 1, 'Island top overhang is two centimeters at front and flush at rear');
    closeTo((await meshBox('island-countertop')).max[1], 90, 'Island total height');
    const positions = [];
    for (const [percent, exposed, hidden] of [[100, 110, 0], [50, 75, 35], [0, 40, 70]]) {
      await extend(percent);
      const info = await metadata(), top = await meshBox('island-tabletop');
      closeTo(info.extensionCm, exposed, 'Exposed table length'); closeTo(info.retractionCm, hidden, 'Hidden table length');
      closeTo(top.width, 110, 'A rigid tabletop keeps its full physical length while retracting');
      closeTo(top.depth, 90, 'Rigid tabletop depth'); closeTo(top.max[1], 76, 'Table height');
      const leftSide = await meshBox('island-left-side-lower'), frontLeg = await meshBox('island-table-leg-front'), backLeg = await meshBox('island-table-leg-back');
      closeTo(top.max[0] - leftSide.min[0], hidden, 'Retraction physically enters the cabinet');
      assert(frontLeg.max[0] < leftSide.min[0] && backLeg.max[0] < leftSide.min[0], 'Both simple legs stay outside the cabinet');
      closeTo(frontLeg.min[1], 0, 'Front leg reaches floor'); closeTo(backLeg.min[1], 0, 'Rear leg reaches floor');
      assert(frontLeg.min[2] > 0 && backLeg.max[2] < 0, 'There is one leg on each side of the table');
      assert((await page.locator('#extensionValue').innerText()).includes(String(exposed)), 'Visible extension label matches geometry');
      const colliding = await page.evaluate(() => {
        const root = FormaConfigurator.getScene().getObjectByName('bar'), top = root.getObjectByName('island-tabletop');
        root.updateMatrixWorld(true); const tableBox = new THREE.Box3().setFromObject(top), collisions = [];
        root.traverse(mesh => {
          if (!mesh.isMesh || mesh === top) return;
          const box = new THREE.Box3().setFromObject(mesh);
          const overlap = box.max.clone().min(tableBox.max).sub(box.min.clone().max(tableBox.min));
          if (overlap.x > 0.05 && overlap.y > 0.05 && overlap.z > 0.05) collisions.push(mesh.name);
        });
        return collisions;
      });
      assert.deepEqual(colliding, [], 'The rigid tabletop and hidden storage bay do not intersect furniture parts');
      positions.push({ percent, top, frontLeg });
      assert.equal(info.variant, 'island');
    }
    assert(positions[0].frontLeg.center[0] < positions[2].frontLeg.center[0], 'The outside support moves toward the cabinet when retracting');
    await page.screenshot({ path: path.join(QA, 'island-retracted-desktop.png') });
    await extend(100);

    await input('#frontsUpperHex', '#eee4ce'); await page.selectOption('#frontsUpperFinish', 'wood');
    await input('#frontsLowerHex', '#426452'); await page.selectOption('#frontsLowerFinish', 'matte'); await settle(page);
    const colored = await snapshot();
    for (const [role, color, finish] of [['frontsUpper', 'eee4ce', 'wood'], ['frontsLower', '426452', 'matte']]) {
      const fronts = colored.filter(mesh => mesh.role === role); assert(fronts.length);
      assert(fronts.every(mesh => mesh.color === color && mesh.finish === finish), role + ' uses its separate material');
    }
    const upper = colored.filter(mesh => mesh.role === 'frontsUpper'), lower = colored.filter(mesh => mesh.role === 'frontsLower');
    assert(Math.min(...upper.map(mesh => mesh.min[1])) > Math.max(...lower.map(mesh => mesh.max[1])), 'Upper drawers and lower doors/drawers have distinct palettes');
    const closedRear = await meshBox('island-rear-door-left'), closedFront = await meshBox('island-front-door');
    await page.check('#doorsOpen'); await settle(page);
    assert.notDeepEqual((await meshBox('island-rear-door-left')).rotation, closedRear.rotation, 'Rear doors open for shelf access');
    assert.notDeepEqual((await meshBox('island-front-door')).rotation, closedFront.rotation, 'Front door opens');
    await meshBox('island-rear-door-right');
    for (let shelf = 1; shelf <= 3; shelf++) await meshBox('island-rear-shelf-' + shelf);
    await page.screenshot({ path: path.join(QA, 'island-open-desktop.png') });
    await page.click('[data-view="back"]'); await settle(page);
    await page.screenshot({ path: path.join(QA, 'island-rear-open-desktop.png'), animations: 'disabled' });
    await page.click('[data-view="perspective"]'); await settle(page);
    await page.uncheck('#doorsOpen'); await settle(page);
    await page.screenshot({ path: path.join(QA, 'island-full-desktop.png') });

    await choose('bar');
    assert.deepEqual((await state()).sizes.bar, originalBarState.sizes.bar);
    // Geometry is compared independently of the deliberately edited material colors.
    const geometryOnly = meshes => meshes.map(({ color, finish, ...geometry }) => geometry);
    assert.deepEqual(geometryOnly(await snapshot()), geometryOnly(originalBarGeometry), 'Selecting the island never changes the existing bar geometry');
    assert.deepEqual(await metrics(), originalBarMetrics);
    await dimensions({ width: 100, depth: 100, height: 120 });
    await editTop('bar', { width: 125, depth: 135, offsetX: 6, offsetZ: -3 });
    const savedBar = clone((await state()).sizes.bar), savedBarTop = clone((await state()).worktops.bar);
    await choose('island');
    await dimensions({ width: 100, depth: 100, height: 100, tableLength: 140, tableHeight: 78, tableDepth: 88, tableRetraction: 80 });
    const expectedIsland = { width: 100, depth: 100, height: 100, tableLength: 140, tableHeight: 78, tableDepth: 88, tableRetraction: 80 };
    assert.deepEqual((await state()).sizes.island, expectedIsland);
    await extend(0); closeTo((await metadata()).extensionCm, 60, 'Editable retraction sets the minimum exposed table length');
    closeTo((await meshBox('island-tabletop')).width, 140, 'Resized table stays rigid');
    await extend(50);
    const bodyBefore = await snapshot(page, true), tableBefore = await meshBox('island-tabletop');
    await editTop('island', { width: 135, depth: 124, offsetX: 8, offsetZ: -4 });
    assert.deepEqual(await meshBox('island-tabletop'), tableBefore, 'Island counter edits preserve the table');
    await editTop('islandTable', { width: 120, depth: 104, offsetX: -6, offsetZ: 3 });
    closeTo((await meshBox('island-tabletop')).width, 160, 'Tabletop size adds exposed surplus to its hidden section');
    assert.deepEqual(await snapshot(page, true), bodyBefore, 'Top edits do not resize, move or distort the body and simple legs');
    assert.deepEqual((await state()).sizes.island, expectedIsland);
    const editedIsland = clone((await state()).sizes.island), editedTops = clone((await state()).worktops);
    await choose('bar'); assert.deepEqual((await state()).sizes.bar, savedBar); assert.deepEqual((await state()).worktops.bar, savedBarTop);
    await choose('island'); assert.deepEqual((await state()).sizes.island, editedIsland); assert.deepEqual((await state()).worktops, editedTops);
    await page.selectOption('#worktopSelect', 'island'); await page.click('#centerWorktop'); await settle(page);
    closeTo((await meshBox('island-countertop')).center[2], 0, 'Center command centers the island countertop');
    await page.click('#resetWorktop'); await settle(page);
    assert.deepEqual((await state()).worktops.island, { widthDelta: 0, depthDelta: 0, offsetX: 0, offsetZ: 1 }, 'Reset restores asymmetric reference overhang');
    assert.deepEqual((await state()).worktops.islandTable, editedTops.islandTable, 'Reset affects only the selected top');

    // Independent constraints prevent a hidden tabletop from exceeding the body or its own full length.
    assert.equal(await page.locator('#size-tableRetraction').getAttribute('max'), '90');
    await dimensions({ tableRetraction: 999 });
    assert.equal((await state()).sizes.island.tableRetraction, 80, 'An invalid direct edit preserves the previous value');
    await dimensions({ tableRetraction: 90 });
    await dimensions({ tableLength: 70 });
    assert.equal((await state()).sizes.island.tableRetraction, 50);
    assert.equal(await page.locator('#size-tableHeight').getAttribute('max'), '88');
    await dimensions({ tableHeight: 999 });
    assert.equal((await state()).sizes.island.tableHeight, 78, 'An invalid height edit preserves the previous table height');
    await dimensions({ tableHeight: 88 });
    assert.equal((await state()).sizes.island.tableHeight, 88);
    await dimensions({ width: 100, height: 100, depth: 100, tableLength: 140, tableDepth: 88, tableHeight: 78, tableRetraction: 80 });
    await page.check('#doorsOpen'); await settle(page);
    const expected = await state(), expectedGeometry = await snapshot(), expectedMetrics = await metrics();
    const savedPromise = page.waitForEvent('download'); await page.click('#saveBtn');
    const projectPath = path.join(QA, 'island-project-v6.json'); await (await savedPromise).saveAs(projectPath);
    const project = JSON.parse(fs.readFileSync(projectPath)); assert.equal(project.version, 6); assert.deepEqual(project.configuration, expected);
    await choose('bar'); await page.setInputFiles('#projectFile', projectPath); await settle(page);
    assert.deepEqual(await state(), expected, 'Project v6 restores the island, both dimension sets and all five worktops');
    assert.deepEqual(await snapshot(), expectedGeometry);
    await page.reload(); await ready(page); assert.deepEqual(await state(), expected, 'Local persistence restores the selected variant');

    const url = await share(), payload = decode(url);
    assert.equal(payload.v, 3); assert.equal(payload.barVariant, 'island');
    assert.deepEqual(payload.sizes.island, expected.sizes.island); assert.deepEqual(payload.worktops, expected.worktops);
    const recipientContext = await context(), recipient = await recipientContext.newPage();
    recipient.on('pageerror', error => errors.push(error.message)); await recipient.goto(url); await ready(recipient);
    assert.equal((await state(recipient)).barVariant, 'island');
    assert.deepEqual((await state(recipient)).sizes.island, expected.sizes.island);
    assert.deepEqual((await state(recipient)).worktops, expected.worktops);
    assert.deepEqual(await snapshot(recipient), expectedGeometry, 'An independent recipient recreates the same geometry and materials');
    await recipient.click('[data-bar-variant="bar"]'); await settle(recipient);
    assert.equal(decode(recipient.url()).barVariant, 'bar', 'Editing a shared variant updates the inbound URL');
    await recipientContext.close();

    for (const mutate of [value => { value.barVariant = 'unknown'; }, value => { delete value.barVariant; }, value => { delete value.sizes.island; }, value => { delete value.worktops.islandTable; }, value => { value.sizes.island.tableRetraction = value.sizes.island.width; }, value => { value.sizes.island.tableHeight = value.sizes.island.height; }]) {
      const invalid = clone(payload); invalid.top = '#ff0000'; mutate(invalid);
      await page.goto(linkFor(invalid)); await ready(page);
      assert.deepEqual(await state(), expected, 'Invalid variant configuration is rejected without applying partial edits');
    }
    const invalidProject = clone(expected); invalidProject.barVariant = 'unknown'; invalidProject.top = '#ff0000';
    await importProject(invalidProject); assert.deepEqual(await state(), expected, 'Invalid project variant does not mutate the current scene');
    const legacy = clone(payload); legacy.v = 2;
    delete legacy.barVariant; delete legacy.sizes.island; delete legacy.worktops.island; delete legacy.worktops.islandTable;
    await page.goto(linkFor(legacy)); await ready(page);
    assert.equal((await state()).barVariant, 'bar', 'Existing v2 links always open the original bar');
    assert.deepEqual((await state()).sizes.bar, expected.sizes.bar);
    assert.deepEqual((await state()).sizes.island, DEFAULT_ISLAND);
    const legacyProject = clone(expected); delete legacyProject.barVariant; delete legacyProject.sizes.island; delete legacyProject.worktops.island; delete legacyProject.worktops.islandTable;
    await importProject(legacyProject, 5); assert.equal((await state()).barVariant, 'bar', 'Version 5 projects default to the original bar');
    assert.deepEqual((await state()).sizes.bar, expected.sizes.bar);
    await page.evaluate(value => localStorage.setItem('forma-furniture-v1', JSON.stringify(value)), legacyProject);
    await page.goto(BASE); await ready(page); assert.equal((await state()).barVariant, 'bar', 'Saved pre-island projects remain usable');
    await importProject(expected); assert.deepEqual(await state(), expected);

    // The selector and both sets of controls remain usable in the existing mobile dark layout.
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('html').getAttribute('data-theme') !== 'dark') await page.click('#themeToggle');
    await page.locator('#barVariantControl').scrollIntoViewIfNeeded();
    for (const variant of ['bar', 'island']) {
      const box = await page.locator(`[data-bar-variant="${variant}"]`).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 391, 'Variant picker fits mobile');
    }
    await page.screenshot({ path: path.join(QA, 'island-mobile-dark.png'), animations: 'disabled' });
    await page.click('#shareAppearanceBtn');
    assert((await page.locator('#share-model-value').innerText()).toLocaleLowerCase('ro').includes('insul'), 'Sharing summary names the island variant');
    const dialog = await page.locator('#shareAppearanceDialog').boundingBox();
    assert(dialog && dialog.x >= 0 && dialog.x + dialog.width <= 391 && dialog.y >= 0 && dialog.y + dialog.height <= 845);
    await page.screenshot({ path: path.join(QA, 'island-share-mobile-dark.png') });
    await page.keyboard.press('Escape');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal mobile overflow');
    assert.deepEqual(await metrics(), expectedMetrics);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, originalBarUnchanged: true, islandDimensions: true, rigidTableRetraction: true, simpleLegs: true, distinctFrontMaterials: true, rearDoors: true, independentDimensionsAndWorktops: true, dependentBounds: true, projectV6: true, sharedV3: true, legacyV2AndV5: true, malformedInputAtomic: true, mobileDark: true, errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(QA, 'island-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
