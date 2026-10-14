const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const QA = path.join(__dirname, 'qa');
const FILE = path.join(__dirname, 'configurator-mobilier.html');
const BASE = 'https://forma.example/configurator/';
const ROLES = ['top', 'frontsUpper', 'frontsLower', 'body'];
const APPEARANCE = [...ROLES, ...ROLES.map(role => role + 'Finish')];
const ZONES = ['frontsUpper', 'frontsLower'];
const colors = state => Object.fromEntries(APPEARANCE.map(key => [key, state[key]]));
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = url => JSON.parse(Buffer.from(new URL(url).searchParams.get('config'), 'base64url').toString());
const link = (value, parameter = 'config') => { const url = new URL(BASE); url.searchParams.set(parameter, encode(value)); return url.href; };
const legacyAppearance = { top: '#bb8844', fronts: '#446688', body: '#aabbcc', topFinish: 'wood', frontsFinish: 'stone', bodyFinish: 'matte' };
const migrated = { top: legacyAppearance.top, frontsUpper: legacyAppearance.fronts, frontsLower: legacyAppearance.fronts, body: legacyAppearance.body, topFinish: legacyAppearance.topFinish, frontsUpperFinish: legacyAppearance.frontsFinish, frontsLowerFinish: legacyAppearance.frontsFinish, bodyFinish: legacyAppearance.bodyFinish };

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--enable-unsafe-swiftshader'] });
  const errors = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    await context.setOffline(true);
    await context.route(BASE + '**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FILE) }));
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    const ready = async () => page.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    const settle = async () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const state = async () => page.evaluate(() => FormaConfigurator.getState());
    const input = async (role, hex, finish) => {
      await page.fill('#' + role + 'Hex', hex); await page.locator('#' + role + 'Hex').press('Tab');
      if (finish) await page.selectOption('#' + role + 'Finish', finish);
      await settle();
    };
    async function materials() {
      return page.evaluate(() => {
        const model = FormaConfigurator.getScene().getObjectByName(FormaConfigurator.getState().model), result = [];
        model.updateMatrixWorld(true);
        model.traverse(mesh => {
          if (!mesh.isMesh) return;
          const role = mesh.userData.role;
          if (!['frontsUpper', 'frontsLower', 'glass', 'top', 'body'].includes(role)) return;
          const bounds = new THREE.Box3().setFromObject(mesh);
          result.push({ role, color: mesh.material.color.getHexString(), finish: mesh.material.userData.finish, texture: !!mesh.material.map, min: bounds.min.toArray(), max: bounds.max.toArray() });
        });
        return result;
      });
    }
    async function assertMaterials() {
      const actual = await materials(), config = await state();
      for (const role of ZONES) {
        const matching = actual.filter(mesh => mesh.role === role);
        assert(matching.length, 'Model has ' + role + ' geometry');
        assert(matching.every(mesh => mesh.color === config[role].slice(1)), role + ' independently uses its chosen color');
        assert(matching.every(mesh => mesh.finish === config[role + 'Finish']), role + ' independently uses its chosen finish');
        assert(matching.every(mesh => mesh.texture === (config[role + 'Finish'] !== 'matte')), role + ' has the requested surface texture');
      }
      return actual;
    }
    async function importProject(configuration, version) {
      await page.setInputFiles('#projectFile', { name: 'fronts-v' + version + '.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'forma-furniture', version, configuration })) });
      await settle();
    }
    await page.goto(BASE); await ready();
    assert.equal(await page.locator('#frontsColor').count(), 0, 'The old single front picker is replaced');
    for (const role of ZONES) {
      assert(await page.locator('#' + role + 'Color').isVisible());
      assert(await page.locator('#' + role + 'Finish').isVisible());
    }
    await input('frontsUpper', '#c43d68', 'wood');
    const beforeLower = await materials();
    await input('frontsLower', '#247b91', 'matte');
    const afterLower = await assertMaterials();
    assert.deepEqual(afterLower.filter(mesh => mesh.role !== 'frontsLower'), beforeLower.filter(mesh => mesh.role !== 'frontsLower'), 'Editing lower fronts preserves upper fronts, body and top');
    await page.uncheck('#glass'); await settle();
    const closedSolid = await assertMaterials();
    const highestLower = Math.max(...closedSolid.filter(mesh => mesh.role === 'frontsLower').map(mesh => mesh.max[1]));
    const lowestUpper = Math.min(...closedSolid.filter(mesh => mesh.role === 'frontsUpper').map(mesh => mesh.min[1]));
    assert(highestLower < lowestUpper, 'Cabinet doors are assigned to physical upper and lower units');
    await page.check('#doorsOpen'); await settle(); await assertMaterials();
    await page.check('#glass'); await settle(); await assertMaterials();
    await page.screenshot({ path: path.join(QA, 'fronts-cabinet-desktop.png') });
    await page.click('[data-model="bar"]'); await settle();
    await page.uncheck('#doorsOpen'); await settle();
    const bar = await assertMaterials();
    const topOfDoors = Math.max(...bar.filter(mesh => mesh.role === 'frontsLower').map(mesh => mesh.max[1]));
    const bottomOfDrawers = Math.min(...bar.filter(mesh => mesh.role === 'frontsUpper').map(mesh => mesh.min[1]));
    assert(topOfDoors < bottomOfDrawers, 'Bar drawers use the upper palette and doors use the lower palette');
    for (const role of ZONES) {
      const front = bar.filter(mesh => mesh.role === role);
      assert(front.some(mesh => mesh.min[2] > 0) && front.some(mesh => mesh.max[2] < 0), role + ' applies to both sides of the bar');
    }
    await page.check('#doorsOpen'); await settle(); await assertMaterials();
    await page.screenshot({ path: path.join(QA, 'fronts-bar-desktop.png') });

    const expected = await state();
    const savePromise = page.waitForEvent('download'); await page.click('#saveBtn');
    const projectPath = path.join(QA, 'fronts-project-v5.json'); await (await savePromise).saveAs(projectPath);
    const saved = JSON.parse(fs.readFileSync(projectPath));
    assert.equal(saved.version, 5);
    assert.deepEqual(saved.configuration, expected);
    assert(!('fronts' in saved.configuration) && !('frontsFinish' in saved.configuration), 'New projects contain independent front zones only');
    await page.click('[data-palette="cashmere"]'); await settle();
    await page.setInputFiles('#projectFile', projectPath); await settle();
    assert.deepEqual(await state(), expected, 'Version 5 saves both independent colors and finishes');
    await page.reload(); await ready();
    assert.deepEqual(await state(), expected, 'Local persistence retains both front zones');
    await assertMaterials();

    await page.click('#shareAppearanceBtn');
    const url = await page.inputValue('#appearanceShareUrl'), payload = decode(url);
    assert.equal(payload.v, 2);
    assert.deepEqual(colors(payload), colors(expected));
    for (const role of ROLES) assert((await page.locator('#share-' + role + '-value').innerText()).includes(expected[role].toUpperCase()));
    await page.click('#closeAppearanceShare');
    const recipientContext = await browser.newContext();
    await recipientContext.setOffline(true);
    await recipientContext.route(BASE + '**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FILE) }));
    const recipient = await recipientContext.newPage(); recipient.on('pageerror', error => errors.push(error.message));
    await recipient.goto(url); await recipient.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    assert.deepEqual(colors(await recipient.evaluate(() => FormaConfigurator.getState())), colors(expected), 'A recipient restores separate upper and lower colors and finishes');
    await recipientContext.close();

    const incomplete = { ...payload, top: '#ff0000' }; delete incomplete.frontsLowerFinish;
    await page.goto(link(incomplete)); await ready();
    assert.deepEqual(await state(), expected, 'Incomplete v2 shared data is rejected atomically');
    const legacyFull = { ...payload, v: 1, ...legacyAppearance };
    for (const key of ['frontsUpper', 'frontsLower', 'frontsUpperFinish', 'frontsLowerFinish']) delete legacyFull[key];
    await page.goto(link(legacyFull)); await ready();
    assert.deepEqual(colors(await state()), migrated, 'Legacy full v1 links duplicate the former front material into both zones');
    assert.deepEqual((await state()).sizes, expected.sizes);
    await assertMaterials();
    const oldProject = { ...expected, ...legacyAppearance };
    for (const key of ['frontsUpper', 'frontsLower', 'frontsUpperFinish', 'frontsLowerFinish']) delete oldProject[key];
    await input('frontsUpper', '#aa0000', 'matte');
    await importProject(oldProject, 4);
    assert.deepEqual(colors(await state()), migrated, 'Legacy v4 project colors and finishes migrate to both zones');
    await page.evaluate(value => localStorage.setItem('forma-furniture-v1', JSON.stringify(value)), oldProject);
    await page.goto(BASE); await ready();
    assert.deepEqual(colors(await state()), migrated, 'Existing local projects migrate without manual export/import');
    await page.goto(link({ v: 2, ...colors(expected) }, 'finisaje')); await ready();
    assert.deepEqual(colors(await state()), colors(expected), 'Appearance-only v2 links preserve separate front zones');

    for (const preset of ['oak', 'cashmere', 'sage']) {
      await page.click('[data-palette="' + preset + '"]'); await settle();
      const config = await state();
      assert.equal(config.palette, preset);
      assert.equal(config.frontsUpper, config.frontsLower, 'Preset sets both front colors');
      assert.equal(config.frontsUpperFinish, config.frontsLowerFinish, 'Preset sets both front finishes');
      await assertMaterials();
    }
    const sage = colors(await state());
    await input('frontsUpper', '#c43d68', 'wood'); await input('frontsLower', '#247b91', 'stone');
    await page.click('#resetBtn'); await settle();
    assert.deepEqual(colors(await state()), sage, 'Reset restores both front zones');
    await input('frontsUpper', '#c43d68', 'wood'); await input('frontsLower', '#247b91', 'stone');
    const pngPromise = page.waitForEvent('download'); await page.click('#pngBtn');
    const pngPath = path.join(QA, 'fronts-export.png'); await (await pngPromise).saveAs(pngPath);
    assert.deepEqual([...fs.readFileSync(pngPath).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.click('#shareAppearanceBtn');
    assert.equal(await page.locator('.appearance-share-preview > div').count(), 4);
    for (const role of ROLES) {
      const box = await page.locator('#share-' + role + '-value').boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 391 && box.y >= 0 && box.y + box.height <= 845, role + ' sharing summary fits mobile');
    }
    await page.screenshot({ path: path.join(QA, 'fronts-sharing-mobile.png') });
    await page.keyboard.press('Escape');
    await page.locator('#frontsLowerHex').scrollIntoViewIfNeeded();
    for (const role of ZONES) {
      const box = await page.locator('#' + role + 'Hex').boundingBox();
      assert(box && box.x >= 0 && box.x + box.width <= 391, role + ' picker fits mobile');
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.screenshot({ path: path.join(QA, 'fronts-pickers-mobile.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, independentUpperLowerMaterials: true, glassFramesAndSolidDoors: true, barDrawersAndBothDoorFaces: true, projectV5: true, sharedV2: true, legacyV1Share: true, legacyV4ProjectAndLocalMigration: true, malformedV2Atomic: true, presetsAndReset: true, png: true, fourMobileSwatches: true, errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(QA, 'fronts-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
