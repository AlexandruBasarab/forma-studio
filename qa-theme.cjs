const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const FILE = path.join(__dirname, 'configurator-mobilier.html');
const BASE = pathToFileURL(FILE).href;
const QA = path.join(__dirname, 'qa');
const STORAGE = 'forma-theme-v1';

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  const errors = [], network = [];
  let page;
  try {
    const ready = async p => p.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
    const state = p => p.evaluate(() => FormaConfigurator.getState());
    const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const theme = p => p.locator('html').getAttribute('data-theme');
    const preference = p => p.evaluate(key => localStorage.getItem(key), STORAGE);
    const watch = p => {
      p.on('pageerror', error => errors.push(error.message));
      p.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    };
    async function newContext(colorScheme, init) {
      const context = await browser.newContext({ colorScheme, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
      await context.setOffline(true);
      if (init) await context.addInitScript(init);
      const p = await context.newPage(); watch(p); await p.goto(BASE); await ready(p);
      return { context, page: p };
    }
    async function modelSnapshot(p) {
      return p.evaluate(() => {
        const scene = FormaConfigurator.getScene(); scene.updateMatrixWorld(true);
        const model = scene.getObjectByName(FormaConfigurator.getState().model), meshes = [];
        model.traverse(object => {
          if (!object.isMesh) return;
          const box = new THREE.Box3().setFromObject(object);
          meshes.push({ name: object.name, matrix: object.matrixWorld.toArray(), min: box.min.toArray(), max: box.max.toArray(), materials: (Array.isArray(object.material) ? object.material : [object.material]).map(material => ({ color: material.color?.getHexString(), roughness: material.roughness, metalness: material.metalness, opacity: material.opacity, texture: !!material.map })) });
        });
        return { state: FormaConfigurator.getState(), metrics: FormaConfigurator.getMetrics(), meshes };
      });
    }
    async function assertTheme(p, expected) {
      await p.waitForFunction(value => document.documentElement.dataset.theme === value, expected);
      assert.equal(await p.locator('#themeToggle').getAttribute('aria-pressed'), String(expected === 'dark'));
      const label = await p.locator('#themeToggle').getAttribute('aria-label'), title = await p.locator('#themeToggle').getAttribute('title');
      assert(label?.trim() && title?.trim(), 'Theme toggle explains its action to sighted and assistive users');
      return { label, title };
    }
    async function shareToken(p) {
      await p.click('#shareAppearanceBtn');
      const link = await p.inputValue('#appearanceShareUrl');
      const token = new URL(link).searchParams.get('config');
      const payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
      assert(!Object.keys(payload).some(key => /theme/i.test(key)), 'Shared configuration does not include the local theme');
      return token;
    }

    const light = await newContext('light');
    assert.equal(await theme(light.page), 'light', 'A new visitor follows the light OS preference');
    await assertTheme(light.page, 'light');
    assert.equal(await preference(light.page), null, 'Following the OS does not create an explicit preference');
    await light.context.close();

    const dark = await newContext('dark'); page = dark.page;
    await assertTheme(page, 'dark');
    assert.equal(await preference(page), null);
    await page.emulateMedia({ colorScheme: 'light' });
    const lightLabel = await assertTheme(page, 'light');
    assert.equal(await preference(page), null, 'OS changes remain automatic until the user toggles');
    await page.emulateMedia({ colorScheme: 'dark' }); await assertTheme(page, 'dark');
    await page.emulateMedia({ colorScheme: 'light' }); await assertTheme(page, 'light');

    const cabinet = await modelSnapshot(page);
    await page.click('#themeToggle'); await settle(page);
    const darkLabel = await assertTheme(page, 'dark');
    assert.notEqual(darkLabel.label, lightLabel.label, 'Accessible label changes to the opposite action');
    assert.notEqual(darkLabel.title, lightLabel.title, 'Tooltip changes to the opposite action');
    assert.equal(await preference(page), 'dark');
    assert.deepEqual(await modelSnapshot(page), cabinet, 'Dark mode preserves cabinet dimensions, materials, geometry and configuration');
    await page.emulateMedia({ colorScheme: 'light' }); await assertTheme(page, 'dark');
    await page.reload(); await ready(page); await assertTheme(page, 'dark');
    assert.deepEqual(await state(page), cabinet.state, 'Reload preserves the project independently of its theme');
    await page.screenshot({ path: path.join(QA, 'theme-cabinet-dark-desktop.png') });

    const darkToken = await shareToken(page);
    await page.screenshot({ path: path.join(QA, 'theme-share-dark-desktop.png') });
    const dialogColors = await page.locator('#shareAppearanceDialog').evaluate(el => {
      const style = getComputedStyle(el); return { background: style.backgroundColor, color: style.color };
    });
    assert.notEqual(dialogColors.background, 'rgb(255, 255, 255)', 'The dark sharing dialog has a dark surface');
    assert.notEqual(dialogColors.color, dialogColors.background, 'Dialog text remains distinct from the background');
    await page.click('#closeAppearanceShare');
    await page.click('#themeToggle'); await assertTheme(page, 'light');
    const lightToken = await shareToken(page);
    assert.equal(lightToken, darkToken, 'Changing the local theme does not change a shared configuration URL');
    await page.click('#closeAppearanceShare');
    const downloadPromise = page.waitForEvent('download'); await page.click('#saveBtn');
    const download = await downloadPromise, projectPath = path.join(QA, 'theme-project.json');
    await download.saveAs(projectPath);
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    assert.deepEqual(project.configuration, cabinet.state);
    assert(!Object.keys(project).some(key => /theme/i.test(key)) && !Object.keys(project.configuration).some(key => /theme/i.test(key)), 'Exported projects do not contain display preferences');
    await page.click('#themeToggle'); await assertTheme(page, 'dark');
    await page.setInputFiles('#projectFile', projectPath); await settle(page);
    await assertTheme(page, 'dark');
    assert.equal(await preference(page), 'dark', 'Importing a project preserves the theme preference');

    await page.click('[data-model="bar"]'); await settle(page);
    const bar = await modelSnapshot(page);
    await page.click('#themeToggle'); await assertTheme(page, 'light');
    assert.deepEqual(await modelSnapshot(page), bar, 'Theme toggling preserves the bar and extending table');
    await page.click('#themeToggle'); await assertTheme(page, 'dark');
    await page.screenshot({ path: path.join(QA, 'theme-bar-dark-desktop.png') });

    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Dark mobile page has no horizontal overflow');
    const headerButtons = await page.locator('.header-actions button').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, width: r.width, height: r.height }; }));
    assert(headerButtons.every(box => box.x >= 0 && box.right <= 390 && box.width > 0 && box.height > 0), 'All mobile header actions remain inside the viewport');
    await page.screenshot({ path: path.join(QA, 'theme-mobile-dark.png') });
    await shareToken(page);
    const dialog = await page.locator('#shareAppearanceDialog').boundingBox();
    assert(dialog.x >= 0 && dialog.x + dialog.width <= 391 && dialog.y >= 0 && dialog.y + dialog.height <= 845, 'Dark sharing dialog fits mobile');
    assert(await page.locator('#copyAppearanceLink').isVisible());
    await page.screenshot({ path: path.join(QA, 'theme-share-dark-mobile.png') });
    await page.keyboard.press('Escape');
    await page.locator('#themeToggle').scrollIntoViewIfNeeded();
    await page.locator('#themeToggle').focus(); await page.keyboard.press('Enter'); await assertTheme(page, 'light');
    await page.emulateMedia({ colorScheme: 'dark' }); await assertTheme(page, 'light');
    await page.reload(); await ready(page); await assertTheme(page, 'light');
    assert.equal(await preference(page), 'light', 'An explicit light choice also survives reload');
    await dark.context.close();

    const invalid = await newContext('dark', () => localStorage.setItem('forma-theme-v1', 'unexpected'));
    await assertTheme(invalid.page, 'dark');
    await invalid.page.emulateMedia({ colorScheme: 'light' }); await assertTheme(invalid.page, 'light');
    await invalid.context.close();

    // Private browsing and disabled site storage must not disable the switch.
    const blocked = await newContext('dark', () => {
      Storage.prototype.getItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
      Storage.prototype.setItem = () => { throw new DOMException('Storage blocked', 'SecurityError'); };
    });
    await assertTheme(blocked.page, 'dark');
    const blockedState = await state(blocked.page);
    await blocked.page.click('#themeToggle'); await assertTheme(blocked.page, 'light');
    assert.deepEqual(await state(blocked.page), blockedState);
    await blocked.page.click('#themeToggle'); await assertTheme(blocked.page, 'dark');
    await blocked.context.close();

    assert.deepEqual(network, [], 'Theme functionality works completely offline');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, osLightAndDarkDefaults: true, liveOsChanges: true, explicitPreferenceWins: true, reload: true, accessibleToggle: true, bothModelsUnchanged: true, themeExcludedFromSharingAndProjects: true, storageDenied: true, invalidPreferenceIgnored: true, mobileHeaderAndDialog: true, keyboardToggle: true, offline: true, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(QA, 'theme-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
