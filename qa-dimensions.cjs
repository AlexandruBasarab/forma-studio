const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const DEFAULT_SIZES = {
  custom: { width: 200, height: 215, depth: 50, counterHeight: 90, upperDepth: 30, nicheHeight: 47.5 },
  bar: { width: 80, height: 110, depth: 90, tableLength: 110, tableHeight: 76, tableDepth: 90 },
  photo: {width:100,height:100,depth:50}
};
const CUSTOM = { width: 240, height: 230, depth: 60, counterHeight: 95, upperDepth: 35, nicheHeight: 50 };
const BAR = { width: 100, height: 120, depth: 100, tableLength: 140, tableHeight: 80, tableDepth: 80 };
const qaDir = path.join(__dirname, 'qa');
const closeTo = (actual, expected, label, tolerance = 0.025) => assert(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} should equal ${expected}`);

(async () => {
  fs.mkdirSync(qaDir, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.setOffline(true);
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(pathToFileURL(path.join(__dirname, 'configurator-mobilier.html')).href);
    await page.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);

    const state = () => page.evaluate(() => FormaConfigurator.getState());
    const metrics = () => page.evaluate(() => FormaConfigurator.getMetrics());
    async function choose(model) {
      await page.click(`[data-model="${model}"]`);
      await page.waitForFunction(key => FormaConfigurator.getState().model === key, model);
    }
    async function dimensions(values) {
      for (const [key, value] of Object.entries(values)) {
        if (!['width', 'height', 'depth'].includes(key)) {
          await page.locator('#size-details').evaluate(el => { el.open = true; });
        }
        await page.fill(`#size-${key}`, String(value));
        await page.locator(`#size-${key}`).press('Tab');
        await page.waitForFunction(([field, expected]) => {
          const config = FormaConfigurator.getState();
          return config.sizes[config.model][field] === expected;
        }, [key, value]);
      }
      // State and rebuilt geometry both need to be current before measurement.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function meshBox(name) {
      return page.evaluate(meshName => {
        const scene = FormaConfigurator.getScene();
        scene.updateMatrixWorld(true);
        const object = scene.getObjectByName(meshName);
        if (!object) throw new Error('Missing named mesh: ' + meshName);
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        return { width: size.x, height: size.y, depth: size.z, min: box.min.toArray(), max: box.max.toArray() };
      }, name);
    }
    async function finiteGeometry() {
      return page.evaluate(() => {
        const model = FormaConfigurator.getScene().getObjectByName(FormaConfigurator.getState().model);
        let valid = true;
        model.traverse(object => {
          if (!object.matrixWorld.elements.every(Number.isFinite)) valid = false;
          const vertices = object.geometry?.getAttribute('position')?.array;
          if (vertices && !Array.from(vertices).every(Number.isFinite)) valid = false;
          const p = object.geometry?.parameters;
          if (p && ['width', 'height', 'depth'].some(key => key in p && !(p[key] > 0))) valid = false;
        });
        return valid;
      });
    }
    async function extend(percent) {
      await page.locator('#extension').evaluate((el, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, percent);
      await page.waitForFunction(p => FormaConfigurator.getState().extension === p / 100, percent);
    }

    assert.deepEqual((await state()).sizes, DEFAULT_SIZES);
    await dimensions(CUSTOM);
    assert.deepEqual((await state()).sizes.custom, CUSTOM);
    assert.deepEqual(await metrics(), { width: 240, height: 230, depth: 60 });
    const customTop = await meshBox('custom-countertop');
    closeTo(customTop.width, 240, 'Custom countertop width');
    closeTo(customTop.depth, 60, 'Custom countertop depth');
    closeTo(customTop.max[1], 95, 'Custom countertop elevation');
    const niche = await meshBox('niche-left');
    closeTo(niche.height, 50, 'Niche height');
    closeTo(niche.depth, 35, 'Upper depth');
    closeTo((await meshBox('custom')).height, 230, 'Custom overall height');
    assert(await finiteGeometry(), 'Custom geometry must remain finite and positive');
    await page.screenshot({ path: path.join(qaDir, 'dimensions-custom-desktop.png') });

    await choose('bar');
    assert.deepEqual((await state()).sizes.bar, DEFAULT_SIZES.bar);
    await dimensions(BAR);
    await extend(100);
    assert.deepEqual((await state()).sizes.bar, BAR);
    assert.deepEqual(await metrics(), { width: 240, height: 120, depth: 120 });
    let barTop = await meshBox('bar-countertop');
    closeTo(barTop.width, 100, 'Bar countertop width');
    closeTo(barTop.depth, 120, 'Bar top includes two 10 cm overhangs');
    closeTo(barTop.max[1], 120, 'Bar countertop elevation');
    let tableTop = await meshBox('bar-tabletop');
    closeTo(tableTop.width, 140.5, 'Table extended length plus inserted overlap');
    closeTo(tableTop.depth, 80, 'Table depth');
    closeTo(tableTop.max[1], 80, 'Table height');
    closeTo((await meshBox('bar')).width, 240, 'Bar overall extended width');
    assert(await finiteGeometry(), 'Bar geometry must remain finite and positive');
    if (!(await state()).dimensions) await page.click('#dimensionsBtn');
    await page.screenshot({ path: path.join(qaDir, 'dimensions-bar-desktop.png') });

    await extend(0);
    assert.deepEqual(await metrics(), { width: 130, height: 120, depth: 120 });
    tableTop = await meshBox('bar-tabletop');
    closeTo(tableTop.width, 30.5, 'Table retracted length plus inserted overlap');
    closeTo((await meshBox('bar')).width, 130, 'Bar overall retracted width');
    await page.screenshot({ path: path.join(qaDir, 'dimensions-bar-retracted.png') });
    await extend(100);

    await choose('custom');
    assert.deepEqual((await state()).sizes.custom, CUSTOM, 'Switching models preserves the cabinet dimensions');
    await choose('bar');
    assert.deepEqual((await state()).sizes.bar, BAR, 'Switching models preserves the bar dimensions');

    // Invalid UI values must never propagate into the 3D scene. A bounded value
    // or retention of the last valid value are both acceptable user behavior.
    for (const value of ['-10', '', '1e309']) {
      await page.locator('#size-width').evaluate((el, invalid) => {
        el.value = invalid;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.blur();
      }, value);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert(Number.isFinite((await state()).sizes.bar.width) && (await state()).sizes.bar.width > 0, `Rejected unsafe width ${value}`);
      assert(await finiteGeometry(), `Geometry stays valid after invalid input ${value}`);
    }
    await dimensions({ width: BAR.width });

    await page.fill('#topHex', '#bb3355');
    await page.locator('#topHex').press('Tab');
    await page.waitForFunction(() => FormaConfigurator.getState().top === '#bb3355');
    const savedConfiguration = await state();
    const savePromise = page.waitForEvent('download');
    await page.click('#saveBtn');
    const save = await savePromise;
    const projectPath = path.join(qaDir, 'dimensions-project-v2.json');
    await save.saveAs(projectPath);
    const saved = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    assert.equal(saved.version, 4);
    assert.deepEqual(saved.configuration.sizes, { custom: CUSTOM, bar: BAR,photo:DEFAULT_SIZES.photo });

    await page.click('#resetDimensions');
    let reset = await state();
    assert.deepEqual(reset.sizes.bar, DEFAULT_SIZES.bar, 'Dimension reset restores only the active object');
    assert.deepEqual(reset.sizes.custom, CUSTOM, 'Dimension reset preserves the other object');
    for (const key of ['top', 'fronts', 'body', 'topFinish', 'frontsFinish', 'bodyFinish']) {
      assert.equal(reset[key], savedConfiguration[key], `Dimension reset preserves ${key}`);
    }
    await page.click('[data-palette="cashmere"]');
    await page.setInputFiles('#projectFile', projectPath);
    await page.waitForFunction(() => FormaConfigurator.getState().top === '#bb3355' && FormaConfigurator.getState().sizes.bar.width === 100);
    assert.deepEqual((await state()).sizes, savedConfiguration.sizes, 'JSON v2 roundtrip preserves both objects');
    await page.reload();
    await page.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    assert.deepEqual((await state()).sizes, savedConfiguration.sizes, 'Reload preserves both objects');

    await page.setViewportSize({ width: 414, height: 896 });
    await page.locator('#size-details').evaluate(el => { el.open = true; });
    await page.screenshot({ path: path.join(qaDir, 'dimensions-mobile.png'), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    await page.setViewportSize({ width: 1440, height: 1000 });

    const legacy = { ...saved, version: 1, configuration: { ...saved.configuration } };
    delete legacy.configuration.sizes;
    const legacyPath = path.join(qaDir, 'dimensions-project-v1.json');
    fs.writeFileSync(legacyPath, JSON.stringify(legacy, null, 2));
    await page.setInputFiles('#projectFile', legacyPath);
    await page.waitForFunction(() => FormaConfigurator.getState().sizes.bar.width === 80);
    assert.deepEqual((await state()).sizes, DEFAULT_SIZES, 'Legacy JSON uses reference dimensions');
    assert.equal((await state()).top, savedConfiguration.top, 'Legacy JSON preserves colors');

    // The delivered page is unchanged by this isolated browser context.
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, offline: true, editableDimensions: true, measured3DGeometry: true, independentModels: true, resetPreservesColors: true, invalidInputsSafe: true, jsonV2RoundTrip: true, legacyV1Import: true, persistence: true, mobileNoOverflow: true, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(qaDir, 'dimensions-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
