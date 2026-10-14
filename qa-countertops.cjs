const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const qaDir = path.join(__dirname, 'qa');
const zeroTop = () => ({ widthDelta: 0, depthDelta: 0, offsetX: 0, offsetZ: 0 });
const DEFAULT_WORKTOPS = { cabinet: zeroTop(), bar: zeroTop(), table: zeroTop() };
const closeTo = (actual, expected, label, tolerance = 0.025) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} should equal ${expected}`);

(async () => {
  fs.mkdirSync(qaDir, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.setOffline(true);
    page = await context.newPage();
    const errors = [], network = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(pathToFileURL(path.join(__dirname, 'configurator-mobilier.html')).href);
    await page.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);

    const state = () => page.evaluate(() => FormaConfigurator.getState());
    const metrics = () => page.evaluate(() => FormaConfigurator.getMetrics());
    const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function choose(model) {
      await page.click(`[data-model="${model}"]`);
      await page.waitForFunction(key => FormaConfigurator.getState().model === key, model);
      await settle();
    }
    async function selectTop(key) {
      await page.selectOption('#worktopSelect', key);
      await settle();
    }
    async function edit(values) {
      for (const [key, value] of Object.entries(values)) {
        await page.fill(`#worktop-${key}`, String(value));
        await page.locator(`#worktop-${key}`).press('Tab');
        await settle();
        closeTo(Number(await page.inputValue(`#worktop-${key}`)), value, `Worktop ${key} control`);
      }
    }
    async function meshBox(name) {
      return page.evaluate(meshName => {
        const scene = FormaConfigurator.getScene();
        scene.updateMatrixWorld(true);
        const mesh = scene.getObjectByName(meshName);
        if (!mesh) throw new Error('Missing named mesh: ' + meshName);
        const box = new THREE.Box3().setFromObject(mesh), size = box.getSize(new THREE.Vector3());
        return { width: size.x, height: size.y, depth: size.z, center: box.getCenter(new THREE.Vector3()).toArray(), min: box.min.toArray(), max: box.max.toArray() };
      }, name);
    }
    // Compare every non-top mesh, including the moving support cabinet and
    // fittings: a top edit must never resize or displace the furniture body.
    async function bodySnapshot() {
      return page.evaluate(() => {
        const scene = FormaConfigurator.getScene(); scene.updateMatrixWorld(true);
        const model = scene.getObjectByName(FormaConfigurator.getState().model), snapshot = [];
        model.traverse(mesh => {
          if (!mesh.isMesh) return;
          for (let parent = mesh; parent; parent = parent.parent) {
            if (['custom-countertop', 'bar-countertop', 'bar-tabletop'].includes(parent.name)) return;
          }
          const box = new THREE.Box3().setFromObject(mesh);
          snapshot.push({ name: mesh.name, matrix: mesh.matrixWorld.toArray(), min: box.min.toArray(), max: box.max.toArray() });
        });
        return snapshot;
      });
    }
    async function finiteGeometry() {
      return page.evaluate(() => {
        const model = FormaConfigurator.getScene().getObjectByName(FormaConfigurator.getState().model);
        let valid = true;
        model.traverse(object => {
          if (!object.matrixWorld.elements.every(Number.isFinite)) valid = false;
          const vertices = object.geometry?.getAttribute('position')?.array;
          if (vertices && !Array.from(vertices).every(Number.isFinite)) valid = false;
          if (object.isMesh && [object.scale.x, object.scale.y, object.scale.z].some(n => !Number.isFinite(n) || n <= 0)) valid = false;
        });
        return valid;
      });
    }
    async function extend(percent) {
      await page.locator('#extension').evaluate((el, value) => {
        el.value = String(value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }, percent);
      await page.waitForFunction(p => FormaConfigurator.getState().extension === p / 100, percent);
      await settle();
    }
    function checkBox(box, width, depth, x, z, label) {
      closeTo(box.width, width, `${label} width`); closeTo(box.depth, depth, `${label} depth`);
      closeTo(box.center[0], x, `${label} x`); closeTo(box.center[2], z, `${label} z`);
    }

    assert.equal(await page.locator('#photoUploadBtn').count(), 1, 'External AI launcher is mounted');
    assert.equal(await page.locator('#photoDialog').count(), 1, 'External AI dialog is mounted');
    assert(await page.locator('#worktopSettings').isVisible(), 'Worktop controls are available');
    assert.deepEqual((await state()).worktops, DEFAULT_WORKTOPS);
    assert.equal(await page.inputValue('#worktopSelect'), 'cabinet');
    const cabinetBody = await bodySnapshot();
    const cabinetSizes = (await state()).sizes.custom;
    await edit({ width: 240, depth: 70, offsetX: 10, offsetZ: 5 });
    const customTop = await meshBox('custom-countertop');
    checkBox(customTop, 240, 70, 10, 5, 'Cabinet top');
    closeTo(customTop.max[1], 90, 'Cabinet top stays on cabinet');
    assert.deepEqual((await state()).sizes.custom, cabinetSizes, 'Top edits preserve cabinet dimensions');
    assert.deepEqual(await bodySnapshot(), cabinetBody, 'Top edits preserve all cabinet body geometry');
    assert.deepEqual(await metrics(), { width: 240, height: 215, depth: 70 });
    assert.deepEqual((await state()).worktops.cabinet, { widthDelta: 40, depthDelta: 20, offsetX: 10, offsetZ: 5 });
    if (!(await state()).dimensions) await page.click('#dimensionsBtn');
    await page.screenshot({ path: path.join(qaDir, 'countertops-cabinet-desktop.png') });

    await choose('bar'); await extend(100);
    assert.equal(await page.locator('#worktopSelect option').count(), 2, 'Bar offers both independent tops');
    await selectTop('bar');
    const barBody = await bodySnapshot(), barSizes = (await state()).sizes.bar;
    const oldBarTop = await meshBox('bar-countertop'), oldTableTop = await meshBox('bar-tabletop');
    await edit({ width: 100, depth: 130, offsetX: 15, offsetZ: -5 });
    checkBox(await meshBox('bar-countertop'), 100, 130, oldBarTop.center[0] + 15, -5, 'Bar top');
    assert.deepEqual(await meshBox('bar-tabletop'), oldTableTop, 'Main bar top edits preserve table top');
    await selectTop('table');
    await edit({ width: 140.5, depth: 110, offsetX: -10, offsetZ: 10 });
    checkBox(await meshBox('bar-tabletop'), 140.5, 110, oldTableTop.center[0] - 10, 10, 'Table top');
    assert.deepEqual((await state()).sizes.bar, barSizes, 'Top edits preserve bar and table body dimensions');
    assert.deepEqual(await bodySnapshot(), barBody, 'Top edits preserve all bar and support geometry');
    assert.deepEqual((await state()).worktops.bar, { widthDelta: 20, depthDelta: 20, offsetX: 15, offsetZ: -5 });
    assert.deepEqual((await state()).worktops.table, { widthDelta: 30, depthDelta: 20, offsetX: -10, offsetZ: 10 });
    closeTo((await metrics()).width, 240, 'Bar metrics include offset top ends');
    closeTo((await metrics()).depth, 135, 'Bar metrics include both offset tops');
    await page.screenshot({ path: path.join(qaDir, 'countertops-bar-desktop.png') });

    const editedTops = (await state()).worktops;
    await extend(0);
    assert.deepEqual((await state()).worktops, editedTops, 'Retraction preserves top adjustments');
    closeTo((await meshBox('bar-tabletop')).width, 60.5, 'Retracted table retains added width');
    closeTo(Number(await page.inputValue('#worktop-width')), 60.5, 'Controls show current retracted width');
    await extend(50);
    closeTo((await meshBox('bar-tabletop')).width, 100.5, 'Partly extended table retains added width');
    await extend(100);
    await choose('custom');
    checkBox(await meshBox('custom-countertop'), 240, 70, 10, 5, 'Restored cabinet top');
    await choose('bar'); await selectTop('table');
    assert.deepEqual((await state()).worktops, editedTops, 'Switching models preserves all tops');

    await page.click('#centerWorktop'); await settle();
    checkBox(await meshBox('bar-tabletop'), 140.5, 110, oldTableTop.center[0], 0, 'Centered table top');
    assert.deepEqual((await state()).worktops.bar, editedTops.bar, 'Center affects only selected top');
    await page.click('#resetWorktop'); await settle();
    checkBox(await meshBox('bar-tabletop'), 110.5, 90, oldTableTop.center[0], 0, 'Reset table top');
    assert.deepEqual((await state()).worktops.table, zeroTop());
    assert.deepEqual((await state()).worktops.bar, editedTops.bar, 'Reset affects only selected top');
    assert.deepEqual((await state()).worktops.cabinet, editedTops.cabinet);
    await edit({ width: 140.5, depth: 110, offsetX: -10, offsetZ: 10 });

    for (const field of ['width', 'depth', 'offsetX', 'offsetZ']) {
      for (const value of ['-9999', '9999', '', '1e309']) {
        await page.locator(`#worktop-${field}`).evaluate((el, invalid) => {
          el.value = invalid; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); el.blur();
        }, value);
        await settle();
        const top = await meshBox('bar-tabletop'), config = (await state()).worktops.table;
        assert(top.width >= 19.99 && top.width <= 450.01, 'Width remains bounded');
        assert(top.depth >= 9.99 && top.depth <= 220.01, 'Depth remains bounded');
        assert(Number.isFinite(config.offsetX) && Math.abs(config.offsetX) <= 100, 'Horizontal position remains bounded');
        assert(Number.isFinite(config.offsetZ) && Math.abs(config.offsetZ) <= 100, 'Depth position remains bounded');
        assert(await finiteGeometry(), `Finite 3D geometry after invalid ${field}: ${value}`);
      }
    }
    await edit({ width: 140.5, depth: 110, offsetX: -10, offsetZ: 10 });
    await page.fill('#topHex', '#bb3355'); await page.locator('#topHex').press('Tab'); await settle();
    const savedConfiguration = await state();
    const downloadPromise = page.waitForEvent('download'); await page.click('#saveBtn');
    const download = await downloadPromise, projectPath = path.join(qaDir, 'countertops-project-v4.json');
    await download.saveAs(projectPath);
    const saved = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    assert.equal(saved.version, 4);
    assert.deepEqual(saved.configuration.worktops, savedConfiguration.worktops);
    await page.click('#resetWorktop'); await settle();
    await page.setInputFiles('#projectFile', projectPath);
    await page.waitForFunction(() => FormaConfigurator.getState().worktops.table.widthDelta === 30); await settle();
    assert.deepEqual((await state()).worktops, savedConfiguration.worktops, 'Version 4 project roundtrip');
    assert.equal((await state()).top, '#bb3355', 'Project roundtrip preserves finish color');
    await page.reload(); await page.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    assert.deepEqual((await state()).worktops, savedConfiguration.worktops, 'Local storage roundtrip');
    assert.equal(await page.locator('#photoUploadBtn').count(), 1);
    await selectTop('table');
    checkBox(await meshBox('bar-tabletop'), 140.5, 110, oldTableTop.center[0] - 10, 10, 'Reloaded table top');

    await page.setViewportSize({ width: 414, height: 896 });
    await page.locator('#worktopSettings').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(qaDir, 'countertops-mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    for (const id of ['worktop-width', 'worktop-depth', 'worktop-offsetX', 'worktop-offsetZ']) {
      const box = await page.locator('#' + id).boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 415, `${id} fits on mobile`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });

    const legacy = { ...saved, version: 3, configuration: { ...saved.configuration } };
    delete legacy.configuration.worktops;
    await page.setInputFiles('#projectFile', { name: 'countertops-legacy-v3.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacy)) });
    await page.waitForFunction(() => FormaConfigurator.getState().worktops.table.widthDelta === 0); await settle();
    assert.deepEqual((await state()).worktops, DEFAULT_WORKTOPS, 'Legacy project defaults to original worktops');
    assert.deepEqual((await state()).sizes, savedConfiguration.sizes, 'Legacy import preserves body sizes');
    assert.equal((await state()).top, savedConfiguration.top, 'Legacy import preserves colors');

    const legacyPhotoPath = path.join(qaDir, 'photo-project.json');
    if (fs.existsSync(legacyPhotoPath)) {
      await page.setInputFiles('#projectFile', legacyPhotoPath);
      await page.waitForFunction(() => FormaConfigurator.getState().model === 'photo'); await settle();
      assert(await finiteGeometry(), 'Existing photo model remains usable');
      assert(await page.locator('#worktopSettings').isHidden(), 'Separate top controls hide for old photo volume');
      assert.equal(await page.locator('#photoUploadBtn').count(), 1, 'AI launcher also supports legacy photo projects');
      assert.equal(await page.locator('#photoDialog').count(), 1);
      await page.fill('#size-width', '175'); await page.locator('#size-width').press('Tab'); await settle();
      closeTo((await metrics()).width, 175, 'Existing photo dimensions remain editable');
    }

    assert.deepEqual(errors, [], 'No JavaScript errors');
    assert.deepEqual(network, [], 'No external network dependency');
    console.log(JSON.stringify({ passed: true, offline: true, externalAILauncher: true, threeIndependentWorktops: true, bodyGeometryUnchanged: true, overhangMetrics: true, tableExtension: true, centerAndReset: true, invalidInputSafe: true, projectV4Roundtrip: true, legacyV3Import: true, legacyPhotoCompatible: fs.existsSync(legacyPhotoPath), persistence: true, mobileNoOverflow: true, screenshots: ['countertops-cabinet-desktop.png', 'countertops-bar-desktop.png', 'countertops-mobile.png'], errors }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(qaDir, 'countertops-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
