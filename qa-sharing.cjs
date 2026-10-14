const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const FILE = path.join(__dirname, 'configurator-mobilier.html');
const BASE = pathToFileURL(FILE).href;
const ROLES = ['top', 'fronts', 'body'];
const FIELDS = [...ROLES, ...ROLES.map(role => role + 'Finish')];
const appearance = state => Object.fromEntries(FIELDS.map(key => [key, state[key]]));
// `name` is historical palette metadata normalized by the existing loader.
const remainder = state => Object.fromEntries(Object.entries(state).filter(([key]) => !FIELDS.includes(key) && !['palette', 'name'].includes(key)));
const encode = data => Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
const withAppearance = (data, base = BASE) => {
  const url = new URL(base);
  url.searchParams.set('finisaje', typeof data === 'string' ? data : encode(data));
  return url.href;
};

(async () => {
  fs.mkdirSync(path.join(__dirname, 'qa'), { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  const errors = [], network = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.setOffline(true);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    const ready = async p => p.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    const state = p => p.evaluate(() => FormaConfigurator.getState());
    const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.goto(BASE + '?source=sample%20room&campaign=test#materials');
    await ready(page);
    assert.equal(await page.locator('#shareAppearanceBtn').count(), 1);
    const target = { top: '#bb3355', fronts: '#345678', body: '#eeeecc', topFinish: 'stone', frontsFinish: 'wood', bodyFinish: 'matte' };
    for (const role of ROLES) {
      await page.fill('#' + role + 'Hex', target[role]);
      await page.locator('#' + role + 'Hex').press('Tab');
      await page.selectOption('#' + role + 'Finish', target[role + 'Finish']);
    }
    await settle(page);
    assert.deepEqual(appearance(await state(page)), target);
    await page.click('#shareAppearanceBtn');
    assert(await page.locator('#shareAppearanceDialog').isVisible());
    assert(await page.locator('#appearanceShareUrl').getAttribute('readonly') !== null);
    const shareLink = await page.inputValue('#appearanceShareUrl');
    const shareUrl = new URL(shareLink), token = shareUrl.searchParams.get('finisaje');
    assert.equal(shareUrl.searchParams.get('source'), 'sample room');
    assert.equal(shareUrl.searchParams.get('campaign'), 'test');
    assert.equal(shareUrl.hash, '#materials');
    assert(/^[A-Za-z0-9_-]+$/.test(token), 'Encoded appearance must be URL safe');
    assert.deepEqual(JSON.parse(Buffer.from(token, 'base64url').toString('utf8')), { v: 1, ...target });
    assert(await page.locator('#appearanceLocalNote').isVisible(), 'File links should explain that they are local');
    await page.screenshot({ path: path.join(__dirname, 'qa/share-dialog-desktop.png') });
    await page.click('#closeAppearanceShare');
    assert(!(await page.locator('#shareAppearanceDialog').isVisible()));

    // The generated link works for a recipient without an existing project.
    const recipientContext = await browser.newContext();
    await recipientContext.setOffline(true);
    const recipient = await recipientContext.newPage();
    recipient.on('pageerror', error => errors.push(error.message));
    await recipient.goto(shareLink); await ready(recipient);
    assert.deepEqual(appearance(await state(recipient)), target);
    assert.equal((await state(recipient)).palette, null);
    for (const role of ROLES) {
      assert.equal((await recipient.inputValue('#' + role + 'Hex')).toLowerCase(), target[role]);
      assert.equal(await recipient.inputValue('#' + role + 'Finish'), target[role + 'Finish']);
    }
    await recipient.fill('#topHex', '#aabbcc'); await recipient.locator('#topHex').press('Tab'); await settle(recipient);
    const editedTarget = { ...target, top: '#aabbcc' };
    assert.deepEqual(JSON.parse(Buffer.from(new URL(recipient.url()).searchParams.get('finisaje'), 'base64url').toString('utf8')), { v: 1, ...editedTarget });
    await recipient.reload(); await ready(recipient);
    assert.deepEqual(appearance(await state(recipient)), editedTarget, 'Editing an inbound appearance updates the URL so reload keeps the edit');
    await recipientContext.close();

    // Sharing reopens with the latest controls, rather than an earlier URL.
    await page.click('[data-palette="cashmere"]');
    await settle(page);
    const cashmere = appearance(await state(page));
    await page.click('#shareAppearanceBtn');
    const revisedUrl = await page.inputValue('#appearanceShareUrl');
    assert.notEqual(revisedUrl, shareLink);
    assert.deepEqual(JSON.parse(Buffer.from(new URL(revisedUrl).searchParams.get('finisaje'), 'base64url').toString('utf8')), { v: 1, ...cashmere });
    await page.click('#closeAppearanceShare');

    // An appearance URL takes precedence over saved materials, but does not
    // replace the recipient's current model, dimensions, or countertop setup.
    await page.click('[data-model="bar"]');
    await page.fill('#size-width', '95'); await page.locator('#size-width').press('Tab');
    await page.fill('#worktop-width', '125'); await page.locator('#worktop-width').press('Tab');
    await page.fill('#worktop-offsetX', '12'); await page.locator('#worktop-offsetX').press('Tab');
    await page.check('#doorsOpen');
    await page.locator('#extension').evaluate(el => { el.value = '50'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle(page);
    const localProject = await state(page);
    await page.goto(shareLink); await ready(page);
    assert.deepEqual(appearance(await state(page)), target);
    assert.deepEqual(remainder(await state(page)), remainder(localProject));
    await page.goto(BASE); await ready(page);
    assert.deepEqual(appearance(await state(page)), target, 'Applied URL materials should survive a later ordinary visit');

    // A known palette is recovered from its six material values.
    await page.goto(revisedUrl); await ready(page);
    assert.equal((await state(page)).palette, 'cashmere');
    assert.deepEqual(appearance(await state(page)), cashmere);
    const validBefore = await state(page);
    const invalid = [
      ['unknown-version', encode({ v: 2, ...target })],
      ['bad-color', encode({ v: 1, ...target, body: 'red' })],
      ['bad-finish', encode({ v: 1, ...target, bodyFinish: 'gloss' })],
      ['missing-field', encode({ v: 1, top: '#112233' })],
      ['malformed-base64', '%%%broken%%%'],
      ['non-json', Buffer.from('not JSON', 'utf8').toString('base64url')],
      ['json-null', encode(null)],
      ['oversized', 'a'.repeat(12000)]
    ];
    for (const [label, badToken] of invalid) {
      await page.goto(withAppearance(badToken)); await ready(page);
      assert.deepEqual(await state(page), validBefore, `Reject ${label} without changing the saved project`);
      assert((await page.locator('#toast').innerText()).trim(), `Rejection of ${label} needs a message`);
    }
    const duplicateUrl = new URL(withAppearance({ v: 1, ...target }));
    duplicateUrl.searchParams.append('finisaje', encode({ v: 1, ...cashmere }));
    await page.goto(duplicateUrl.href); await ready(page);
    assert.deepEqual(await state(page), validBefore, 'Reject ambiguous duplicate appearance parameters');
    assert((await page.locator('#toast').innerText()).trim());

    // A simulated static host verifies public links without making a network
    // request. Clipboard writes are captured; denied clipboard and legacy copy
    // force the explicit manual-copy path.
    const hostedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await hostedContext.setOffline(true);
    await hostedContext.route('https://mobilier.example/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: fs.readFileSync(FILE, 'utf8') }));
    await hostedContext.addInitScript(() => {
      window.__clipboardWrites = [];
      window.__copyFailure = false;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { if (window.__copyFailure) throw new Error('Clipboard denied'); window.__clipboardWrites.push(text); } } });
      document.execCommand = () => false;
    });
    const hosted = await hostedContext.newPage();
    hosted.on('pageerror', error => errors.push(error.message));
    await hosted.goto('https://mobilier.example/configurator/?source=host#colors'); await ready(hosted);
    await hosted.click('#shareAppearanceBtn');
    assert(!(await hosted.locator('#appearanceLocalNote').isVisible()), 'Public links should not display the local-file explanation');
    const publicLink = await hosted.inputValue('#appearanceShareUrl');
    assert.equal(new URL(publicLink).origin, 'https://mobilier.example');
    assert.equal(new URL(publicLink).pathname, '/configurator/');
    assert.equal(new URL(publicLink).searchParams.get('source'), 'host');
    assert.equal(new URL(publicLink).hash, '#colors');
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
    await hosted.screenshot({ path: path.join(__dirname, 'qa/share-dialog-mobile.png') });
    const dialog = await hosted.locator('#shareAppearanceDialog').boundingBox();
    assert(dialog.x >= 0 && dialog.x + dialog.width <= 391 && dialog.y >= 0 && dialog.y + dialog.height <= 845, 'Sharing dialog fits a mobile viewport');
    assert(await hosted.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
    await hosted.keyboard.press('Escape');
    assert(!(await hosted.locator('#shareAppearanceDialog').isVisible()));
    await hostedContext.close();
    assert.deepEqual(network, [], 'File-hosted configurator should work completely offline');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, sixFieldsRoundTrip: true, latestMaterials: true, inboundEditsUpdateUrl: true, queryAndHashPreserved: true, localStatePreserved: true, paletteRecovered: true, invalidTokensRejected: invalid.length + 1, clipboardSuccess: true, clipboardDeniedManualCopy: true, publicHost: true, offline: true, mobileDialog: true, pageErrors: errors }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
