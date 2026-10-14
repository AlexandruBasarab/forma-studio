const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const FILE = path.join(__dirname, 'configurator-mobilier.html');
const BASE = pathToFileURL(FILE).href;
const QA = path.join(__dirname, 'qa');
const ROLES = ['top', 'frontsUpper', 'frontsLower', 'body'];
const FIELDS = [...ROLES, ...ROLES.map(role => role + 'Finish')];
const appearance = state => Object.fromEntries(FIELDS.map(key => [key, state[key]]));
const shared = state => ({
  v: 2, model: state.model, ...appearance(state),
  sizes: { custom: state.sizes.custom, bar: state.sizes.bar }, worktops: state.worktops,
  extension: state.extension, glass: state.glass, doorsOpen: state.doorsOpen, dimensions: state.dimensions
});
const remainder = state => Object.fromEntries(Object.entries(state).filter(([key]) => !FIELDS.includes(key) && !['palette', 'name'].includes(key)));
const encode = data => Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
const decode = (link, param = 'config') => JSON.parse(Buffer.from(new URL(link).searchParams.get(param), 'base64url').toString('utf8'));
const withParam = (param, data, base = BASE) => {
  const url = new URL(base);
  url.searchParams.set(param, typeof data === 'string' ? data : encode(data));
  return url.href;
};
const clone = data => JSON.parse(JSON.stringify(data));
const upgradedAppearance = legacy => ({ top: legacy.top, frontsUpper: legacy.fronts, frontsLower: legacy.fronts, body: legacy.body, topFinish: legacy.topFinish, frontsUpperFinish: legacy.frontsFinish, frontsLowerFinish: legacy.frontsFinish, bodyFinish: legacy.bodyFinish });

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  const errors = [], network = [];
  let page;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.setOffline(true);
    page = await context.newPage();
    const watch = p => {
      p.on('pageerror', error => errors.push(error.message));
      p.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    };
    watch(page);
    const ready = async p => p.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    const state = p => p.evaluate(() => FormaConfigurator.getState());
    const metrics = p => p.evaluate(() => FormaConfigurator.getMetrics());
    const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    async function input(p, selector, value) {
      await p.fill(selector, String(value)); await p.locator(selector).press('Tab'); await settle(p);
    }
    async function dimensions(p, values) {
      await p.locator('#size-details').evaluate(el => { el.open = true; });
      for (const [key, value] of Object.entries(values)) await input(p, '#size-' + key, value);
    }
    async function top(p, key, values) {
      await p.selectOption('#worktopSelect', key);
      for (const [field, value] of Object.entries(values)) await input(p, '#worktop-' + field, value);
    }
    async function choose(p, key) { await p.click(`[data-model="${key}"]`); await settle(p); }
    async function extend(p, value) {
      await p.locator('#extension').evaluate((el, percent) => {
        el.value = String(percent); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
      }, value); await settle(p);
    }
    async function sceneSnapshot(p) {
      return p.evaluate(() => {
        const root = FormaConfigurator.getScene().getObjectByName(FormaConfigurator.getState().model);
        FormaConfigurator.getScene().updateMatrixWorld(true);
        const meshes = [], round = n => Math.round(n * 1e5) / 1e5;
        root.traverse(mesh => {
          if (!mesh.isMesh) return;
          const box = new THREE.Box3().setFromObject(mesh);
          const materials = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => ({
            color: material.color?.getHexString(), roughness: material.roughness, metalness: material.metalness,
            opacity: material.opacity, transparent: material.transparent, texture: !!material.map
          }));
          meshes.push({ name: mesh.name, min: box.min.toArray().map(round), max: box.max.toArray().map(round), materials });
        });
        return meshes;
      });
    }
    async function generatedLink(p) {
      await p.click('#shareAppearanceBtn');
      assert(await p.locator('#shareAppearanceDialog').isVisible());
      const url = await p.inputValue('#appearanceShareUrl');
      assert.equal(new URL(url).searchParams.has('finisaje'), false, 'New full links remove legacy appearance parameters');
      assert.deepEqual(decode(url), shared(await state(p)), 'Generated link includes the current complete configuration');
      return url;
    }

    await page.goto(BASE + '?source=sample%20room&campaign=test#configuration'); await ready(page);
    const target = { top: '#bb3355', frontsUpper: '#345678', frontsLower: '#876543', body: '#eeeecc', topFinish: 'stone', frontsUpperFinish: 'wood', frontsLowerFinish: 'matte', bodyFinish: 'matte' };
    for (const role of ROLES) {
      await input(page, '#' + role + 'Hex', target[role]);
      await page.selectOption('#' + role + 'Finish', target[role + 'Finish']);
    }
    assert.deepEqual(appearance(await state(page)), target);
    await dimensions(page, { width: 240, depth: 60, height: 230, counterHeight: 95, upperDepth: 35, nicheHeight: 50 });
    await top(page, 'cabinet', { width: 260, depth: 80, offsetX: 10, offsetZ: -5 });
    await page.uncheck('#glass'); await page.check('#doorsOpen');
    await page.click('#dimensionsBtn'); await settle(page);
    await choose(page, 'bar');
    await dimensions(page, { width: 100, depth: 100, height: 120, tableLength: 140, tableDepth: 80, tableHeight: 80 });
    await extend(page, 50);
    await top(page, 'bar', { width: 120, depth: 140, offsetX: 15, offsetZ: -5 });
    await top(page, 'table', { width: 115.5, depth: 100, offsetX: -10, offsetZ: 10 });
    await choose(page, 'custom');
    await page.check('#doorsOpen'); await settle(page);
    const customExpected = shared(await state(page)), customMetrics = await metrics(page), customScene = await sceneSnapshot(page);
    assert.deepEqual(customMetrics, { width: 260, height: 230, depth: 80 });
    const customLink = await generatedLink(page), customUrl = new URL(customLink);
    assert.equal(customUrl.searchParams.get('source'), 'sample room');
    assert.equal(customUrl.searchParams.get('campaign'), 'test');
    assert.equal(customUrl.hash, '#configuration');
    assert(/^[A-Za-z0-9_-]+$/.test(customUrl.searchParams.get('config')), 'Configuration encoding is URL safe');
    assert(customUrl.searchParams.get('config').length <= 8192);
    assert(await page.locator('#appearanceShareUrl').getAttribute('readonly') !== null);
    assert(await page.locator('#appearanceLocalNote').isVisible());
    for (const id of ['share-model-value', 'share-size-value', 'share-worktops-value', 'share-details-value']) assert((await page.locator('#' + id).innerText()).trim(), `${id} summarizes the shared configuration`);
    await page.screenshot({ path: path.join(QA, 'share-dialog-desktop.png') });
    await page.click('#closeAppearanceShare');
    await choose(page, 'bar');
    await page.check('#doorsOpen'); await settle(page);
    const barExpected = shared(await state(page)), barMetrics = await metrics(page), barScene = await sceneSnapshot(page);
    const barLink = await generatedLink(page); await page.click('#closeAppearanceShare');

    // Both models reproduce their actual meshes, materials and overall bounds
    // for a recipient with no saved local project.
    const recipientContext = await browser.newContext(); await recipientContext.setOffline(true);
    const recipient = await recipientContext.newPage(); watch(recipient);
    for (const [link, expected, expectedMetrics, expectedScene] of [
      [customLink, customExpected, customMetrics, customScene], [barLink, barExpected, barMetrics, barScene]
    ]) {
      await recipient.goto(link); await ready(recipient);
      assert.deepEqual(shared(await state(recipient)), expected);
      assert.deepEqual(await metrics(recipient), expectedMetrics);
      assert.deepEqual(await sceneSnapshot(recipient), expectedScene, 'Shared geometry and all mesh materials match the source');
      for (const role of ROLES) {
        assert.equal((await recipient.inputValue('#' + role + 'Hex')).toLowerCase(), target[role]);
        assert.equal(await recipient.inputValue('#' + role + 'Finish'), target[role + 'Finish']);
      }
    }

    // Every editable category updates an inbound full URL, so reload cannot
    // silently restore the earlier dimensions, tops or functional settings.
    async function urlMatches() { assert.deepEqual(decode(recipient.url()), shared(await state(recipient)), 'Inbound URL follows current controls'); }
    await input(recipient, '#topHex', '#aabbcc'); await urlMatches();
    await recipient.selectOption('#bodyFinish', 'stone'); await settle(recipient); await urlMatches();
    await dimensions(recipient, { width: 110 }); await urlMatches();
    await top(recipient, 'bar', { width: 150, offsetX: 20, offsetZ: -10 }); await urlMatches();
    await top(recipient, 'table', { depth: 105, offsetX: -15 }); await urlMatches();
    await extend(recipient, 25); await urlMatches();
    await recipient.uncheck('#doorsOpen'); await settle(recipient); await urlMatches();
    await recipient.click('#dimensionsBtn'); await settle(recipient); await urlMatches();
    await choose(recipient, 'custom'); await urlMatches();
    await dimensions(recipient, { width: 250 }); await urlMatches();
    await top(recipient, 'cabinet', { depth: 85, offsetZ: 5 }); await urlMatches();
    await recipient.check('#glass'); await settle(recipient); await urlMatches();
    const edited = shared(await state(recipient)), editedMetrics = await metrics(recipient), editedScene = await sceneSnapshot(recipient);
    await recipient.reload(); await ready(recipient);
    assert.deepEqual(shared(await state(recipient)), edited);
    assert.deepEqual(await metrics(recipient), editedMetrics);
    assert.deepEqual(await sceneSnapshot(recipient), editedScene);
    await recipient.goto(BASE); await ready(recipient);
    assert.deepEqual(shared(await state(recipient)), edited, 'Applied shared configuration is retained on a later ordinary visit');
    await recipientContext.close();

    // Full URLs override saved settings, but retain local photo assets that
    // would be unsuitable for a query string.
    const local = await state(page);
    local.photo = {
      descriptor: { version: 1, grid: { width: 2, height: 2, mask: [1, 1, 1, 1] }, aspect: 1, colors: { top: '#cccccc', fronts: '#aaaaaa', body: '#888888' }, confidence: 'limited', warnings: [], bounds: { x: 0, y: 0, width: 1, height: 1 }, sourceWidth: 2, sourceHeight: 2 },
      thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6WZsAAAAASUVORK5CYII=', name: 'Local furniture', initialSize: { width: 100, depth: 50, height: 100 }
    };
    local.sizes.photo = { width: 130, depth: 55, height: 120 };
    await page.evaluate(value => localStorage.setItem('forma-furniture-v1', JSON.stringify(value)), local);
    await page.goto(customLink); await ready(page);
    assert.deepEqual(shared(await state(page)), customExpected);
    assert.deepEqual((await state(page)).photo, local.photo);
    assert.deepEqual((await state(page)).sizes.photo, local.sizes.photo);

    // Existing appearance links continue to change only their original six
    // fields; upgrading via Share produces a complete configuration link.
    const legacyTarget = { top: '#866247', fronts: '#e7dfd2', body: '#ded6c9', topFinish: 'wood', frontsFinish: 'matte', bodyFinish: 'matte' };
    const beforeLegacy = await state(page), legacyLink = withParam('finisaje', { v: 1, ...legacyTarget });
    await page.goto(legacyLink); await ready(page);
    assert.deepEqual(appearance(await state(page)), upgradedAppearance(legacyTarget));
    assert.deepEqual(remainder(await state(page)), remainder(beforeLegacy));
    assert.equal((await state(page)).palette, 'cashmere');
    await input(page, '#frontsUpperHex', '#abcdef');
    assert.equal(new URL(page.url()).searchParams.has('config'), false);
    assert.deepEqual(decode(page.url(), 'finisaje'), { v: 2, ...appearance(await state(page)) });
    const upgradedLink = await generatedLink(page); await page.click('#closeAppearanceShare');
    assert.equal(new URL(upgradedLink).searchParams.has('finisaje'), false);
    const dualLink = withParam('finisaje', { v: 1, ...legacyTarget }, barLink);
    await page.goto(dualLink); await ready(page);
    assert.deepEqual(shared(await state(page)), barExpected, 'Full configuration takes precedence over an appearance parameter');

    // Invalid input must fail atomically, including dependent dimensions and
    // typed booleans/numbers. An invalid full link never falls back to legacy.
    const validBefore = await state(page);
    const bad = mutate => { const value = clone(barExpected); mutate(value); return encode(value); };
    const invalid = [
      ['unknown-version', bad(d => { d.v = 3; })],
      ['missing-upper-front', bad(d => { delete d.frontsUpper; })],
      ['missing-lower-front-finish', bad(d => { delete d.frontsLowerFinish; })],
      ['missing-model', bad(d => { delete d.model; })],
      ['unsupported-model', bad(d => { d.model = 'photo'; })],
      ['bad-color', bad(d => { d.top = 'red'; })],
      ['bad-finish', bad(d => { d.bodyFinish = 'gloss'; })],
      ['missing-sizes', bad(d => { delete d.sizes; })],
      ['missing-size-field', bad(d => { delete d.sizes.custom.width; })],
      ['missing-worktops', bad(d => { delete d.worktops; })],
      ['missing-worktop-field', bad(d => { delete d.worktops.table.offsetZ; })],
      ['string-size', bad(d => { d.sizes.bar.width = '100'; })],
      ['string-offset', bad(d => { d.worktops.bar.offsetX = '10'; })],
      ['string-extension', bad(d => { d.extension = '0.5'; })],
      ['extension-out-of-range', bad(d => { d.extension = 1.01; })],
      ['boolean-string', bad(d => { d.glass = 'true'; })],
      ['boolean-number', bad(d => { d.doorsOpen = 1; })],
      ['missing-boolean', bad(d => { delete d.dimensions; })],
      ['out-of-range-offset', bad(d => { d.worktops.cabinet.offsetX = 101; })],
      ['out-of-range-delta', bad(d => { d.worktops.table.widthDelta = 451; })],
      ['dependent-upper-depth', bad(d => { d.sizes.custom.depth = 30; d.sizes.custom.upperDepth = 40; })],
      ['dependent-niche-height', bad(d => { d.sizes.custom.height = 160; d.sizes.custom.counterHeight = 100; d.sizes.custom.nicheHeight = 60; })],
      ['dependent-table-depth', bad(d => { d.sizes.bar.depth = 60; d.sizes.bar.tableDepth = 100; })],
      ['dependent-table-height', bad(d => { d.sizes.bar.height = 90; d.sizes.bar.tableHeight = 80; })],
      ['malformed-base64', '%%%broken%%%'],
      ['non-json', Buffer.from('not JSON', 'utf8').toString('base64url')],
      ['json-null', encode(null)],
      ['oversized', 'a'.repeat(8193)]
    ];
    for (const [label, token] of invalid) {
      await page.goto(withParam('config', token)); await ready(page);
      assert.deepEqual(await state(page), validBefore, `Reject ${label} without applying any partial configuration`);
      assert((await page.locator('#toast').innerText()).trim(), `Rejection of ${label} needs a message`);
    }
    const duplicate = new URL(barLink); duplicate.searchParams.append('config', encode(customExpected));
    await page.goto(duplicate.href); await ready(page);
    assert.deepEqual(await state(page), validBefore, 'Duplicate full parameters are ambiguous and rejected');
    await page.goto(withParam('config', 'broken', legacyLink)); await ready(page);
    assert.deepEqual(await state(page), validBefore, 'Invalid full configuration never falls back to the valid legacy palette');
    for (const token of [encode({ v: 3, ...target }), encode({ v: 1, top: '#112233' }), '%%%broken%%%', 'a'.repeat(1025)]) {
      await page.goto(withParam('finisaje', token)); await ready(page);
      assert.deepEqual(await state(page), validBefore, 'Malformed legacy links remain safely rejected');
    }
    const duplicateLegacy = new URL(legacyLink); duplicateLegacy.searchParams.append('finisaje', encode({ v: 1, ...target }));
    await page.goto(duplicateLegacy.href); await ready(page);
    assert.deepEqual(await state(page), validBefore, 'Duplicate legacy parameters remain rejected');

    // A simulated static host exercises copying without internet access.
    const hostedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await hostedContext.setOffline(true);
    await hostedContext.route('https://mobilier.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FILE, 'utf8') }));
    await hostedContext.addInitScript(() => {
      window.__clipboardWrites = []; window.__copyFailure = false;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (window.__copyFailure) throw new Error('Clipboard denied'); window.__clipboardWrites.push(text); } } });
      document.execCommand = () => false;
    });
    const hosted = await hostedContext.newPage();
    hosted.on('pageerror', error => errors.push(error.message));
    await hosted.goto('https://mobilier.example/configurator/?source=host#configuration'); await ready(hosted);
    const publicLink = await generatedLink(hosted);
    assert(!(await hosted.locator('#appearanceLocalNote').isVisible()));
    assert.equal(new URL(publicLink).origin, 'https://mobilier.example');
    assert.equal(new URL(publicLink).pathname, '/configurator/');
    assert.equal(new URL(publicLink).searchParams.get('source'), 'host');
    assert.equal(new URL(publicLink).hash, '#configuration');
    await hosted.waitForFunction(() => window.__clipboardWrites.length >= 1);
    const initialCopies = await hosted.evaluate(() => window.__clipboardWrites.length);
    await hosted.click('#copyAppearanceLink');
    await hosted.waitForFunction(count => window.__clipboardWrites.length === count + 1, initialCopies);
    assert((await hosted.evaluate(() => window.__clipboardWrites)).every(value => value === publicLink));
    await hosted.evaluate(() => { window.__copyFailure = true; });
    await hosted.click('#copyAppearanceLink');
    await hosted.waitForFunction(() => document.activeElement.id === 'appearanceShareUrl');
    const selection = await hosted.locator('#appearanceShareUrl').evaluate(el => ({ start: el.selectionStart, end: el.selectionEnd, length: el.value.length }));
    assert.equal(selection.start, 0); assert.equal(selection.end, selection.length);
    assert(await hosted.locator('#shareAppearanceDialog').isVisible());
    await hosted.setViewportSize({ width: 390, height: 844 });
    await hosted.screenshot({ path: path.join(QA, 'share-dialog-mobile.png') });
    const dialog = await hosted.locator('#shareAppearanceDialog').boundingBox();
    assert(dialog.x >= 0 && dialog.x + dialog.width <= 391 && dialog.y >= 0 && dialog.y + dialog.height <= 845, 'Sharing dialog fits a mobile viewport');
    assert(await hosted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    await hosted.keyboard.press('Escape'); assert(!(await hosted.locator('#shareAppearanceDialog').isVisible()));
    await hostedContext.close();
    assert.deepEqual(network, [], 'File configurator works completely offline');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, bothModelsRoundTrip: true, measuredGeometryAndMaterials: true, allDimensionsAndThreeTops: true, functionalSettings: true, inboundEditsUpdateUrl: true, queryAndHashPreserved: true, localPhotoPreserved: true, legacyAppearanceLinks: true, fullPrecedence: true, atomicInvalidTokensRejected: invalid.length + 7, clipboardSuccess: true, clipboardDeniedManualCopy: true, publicHost: true, offline: true, mobileDialog: true, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(QA, 'share-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
