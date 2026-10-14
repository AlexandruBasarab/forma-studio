const { chromium } = require('playwright');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const HTML = path.join(__dirname, 'configurator-mobilier.html');
const QA = path.join(__dirname, 'qa');
const ORIGIN = 'https://forma.test';
const SECRET = 'test-only-openai-credential-not-a-real-key-123456789';
const GEMINI_SECRET = 'test-only-gemini-credential-not-a-real-key-987654';
const SOURCE_NAME = 'private-client-photo-with-original-metadata.png';
const copy = value => JSON.parse(JSON.stringify(value));
const panel = (name, role, position, size) => ({ name, role, shape: 'box', position, size, rotation: { x: 0, y: 0, z: 0 } });
const descriptor = {
  version: 2, kind: 'furniture', name: 'Masă generată de AI', reason: '',
  size: { width: 120, height: 80, depth: 60 },
  colors: { body: '#334455', fronts: '#778899', top: '#b89461' },
  warnings: ['Dimensiuni estimate din fotografie.'],
  parts: [
    panel('Blat', 'top', { x: 0, y: 0.975, z: 0 }, { x: 1, y: 0.05, z: 1 }),
    ...[-0.45, 0.45].flatMap(x => [-0.45, 0.45].map(z => panel('Picior', 'body', { x, y: 0.475, z }, { x: 0.06, y: 0.95, z: 0.06 }))),
    panel('Sertar', 'fronts', { x: 0, y: 0.84, z: 0.45 }, { x: 0.75, y: 0.15, z: 0.04 })
  ]
};

(async () => {
  fs.mkdirSync(QA, { recursive: true });
  const html = fs.readFileSync(HTML, 'utf8');
  assert(html.includes('FurnitureAI') && html.includes('id="aiProvider"'), 'Run npm run build before the AI UI suite');
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined, headless: true, args: ['--allow-file-access-from-files', '--enable-unsafe-swiftshader'] });
  const errors = [], unexpectedRequests = [], calls = [];
  let page, heldRoute = null;
  const session = { configured: true, connected: false, provider: 'openai' };
  let generation = { kind: 'success', descriptor }, connectionFailure = null;
  const ready = p => p.waitForFunction(() => window.FormaConfigurator && document.querySelector('#loading').hidden);
  const state = p => p.evaluate(() => FormaConfigurator.getState());
  const settle = p => p.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const idle = p => p.waitForFunction(() => document.querySelector('#photoDialog').getAttribute('aria-busy') === 'false');
  const watch = p => p.on('pageerror', error => errors.push(error.message));
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, colorScheme: 'light' });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const json = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      if (url.origin === ORIGIN && url.pathname === '/') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
      if (url.origin === ORIGIN && url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
      if (url.origin !== ORIGIN || !url.pathname.startsWith('/api/ai/')) {
        unexpectedRequests.push(request.url()); return route.abort();
      }
      const operation = url.pathname.slice('/api/ai/'.length), body = request.postData() ? JSON.parse(request.postData()) : null;
      calls.push({ operation, method: request.method(), body, url: request.url() });
      if (operation === 'session') return json({ ...session });
      if (operation === 'connect') {
        if (connectionFailure) return json({ error: connectionFailure }, 401);
        assert(['openai', 'gemini'].includes(body.provider));
        assert([SECRET, GEMINI_SECRET].includes(body.apiKey));
        session.connected = true; session.provider = body.provider;
        return json({ connected: true, provider: session.provider });
      }
      if (operation === 'disconnect') { session.connected = false; return json({ connected: false }); }
      if (operation === 'generate') {
        assert.deepEqual(Object.keys(body), ['image'], 'Generation contains only the re-encoded image');
        assert(body.image.startsWith('data:image/jpeg;base64,'));
        assert(!JSON.stringify(body).includes(SOURCE_NAME));
        assert(!JSON.stringify(body).includes(SECRET) && !JSON.stringify(body).includes(GEMINI_SECRET));
        if (generation.kind === 'network') return route.abort('connectionfailed');
        if (generation.kind === 'hold') { heldRoute = route; return; }
        if (generation.kind === 'error') {
          if (generation.status === 401) session.connected = false;
          return json({ error: { code: generation.code, message: generation.message } }, generation.status);
        }
        return json({ descriptor: copy(generation.descriptor) });
      }
      unexpectedRequests.push(request.url()); return route.abort();
    });
    page = await context.newPage(); watch(page);
    await page.goto(ORIGIN + '/'); await ready(page); await settle(page);
    assert.equal(calls.length, 0, 'Opening the configurator makes no AI requests');
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 2400; canvas.height = 1600;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 2400, 1600);
      ctx.fillStyle = '#af8755'; ctx.fillRect(300, 350, 1800, 110);
      ctx.fillStyle = '#445544'; ctx.fillRect(400, 460, 100, 950); ctx.fillRect(1900, 460, 100, 950);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    const upload = p => p.setInputFiles('#photoFile', { name: SOURCE_NAME, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    async function open(p = page) { await p.click('#photoUploadBtn'); await idle(p); assert(await p.locator('#photoDialog').isVisible()); }
    async function connect(provider = 'openai', key = SECRET) {
      await page.selectOption('#aiProvider', provider); await page.fill('#aiKey', key); await page.click('#aiConnect'); await idle(page);
      assert.equal(await page.inputValue('#aiKey'), '', 'Credential field is cleared immediately after connecting');
      assert.equal(await page.locator('#aiConnection').getAttribute('data-connected'), 'true');
      assert(await page.locator('#aiKeyRow').isHidden());
    }
    async function assertNoStoredCredentials(project) {
      const storage = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage), url: location.href, fields: [...document.querySelectorAll('input')].map(input => input.value) }));
      const serialized = JSON.stringify({ storage, project, state: await state(page) });
      assert(!serialized.includes(SECRET) && !serialized.includes(GEMINI_SECRET), 'Keys never enter state, storage, URL, project export or retained fields');
      assert(!JSON.stringify(await state(page)).includes('apiKey'));
    }
    async function generateError(mode, text, remainsConnected = true) {
      const before = await state(page); generation = mode;
      await page.click('#photoGenerate'); await idle(page);
      assert.equal(await page.locator('#photoStatus').getAttribute('data-kind'), 'error');
      assert((await page.textContent('#photoStatus')).includes(text));
      assert.deepEqual(await state(page), before, 'A failed generation preserves the entire current furniture configuration');
      assert.equal(await page.locator('#photoGenerate').isEnabled(), remainsConnected, 'Recoverable failures allow retry; expired sessions require reconnecting');
    }
    await open();
    assert.deepEqual(calls.map(call => call.operation), ['session']);
    assert(await page.locator('#photoGenerate').isDisabled());
    await upload(page); await idle(page);
    assert.equal(calls.length, 1, 'Selecting a file does not send it to the server');
    assert(await page.locator('#photoGenerate').isDisabled(), 'Generation requires a connection');
    const prepared = await page.locator('#photoPreview').evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight, src: image.src }));
    assert.equal(prepared.width, 1536); assert.equal(prepared.height, 1024);
    assert(prepared.src.startsWith('data:image/jpeg;base64,'), 'Image is re-encoded without original file metadata');
    await connect(); await assertNoStoredCredentials();
    assert.equal(calls.filter(call => call.operation === 'generate').length, 0, 'Connecting alone cannot trigger a paid generation');
    await page.screenshot({ path: path.join(QA, 'ai-ready-desktop.png') });
    await page.click('#photoGenerate');
    await page.waitForFunction(() => FormaConfigurator.getState().model === 'photo' && !document.querySelector('#photoDialog').open); await settle(page);
    let current = await state(page);
    assert.equal(current.photo.descriptor.version, 2); assert.equal(current.photo.name, descriptor.name);
    assert.deepEqual(current.sizes.photo, descriptor.size);
    const geometry = await page.evaluate(() => {
      const group = FormaConfigurator.getScene().getObjectByName('photo'), roles = [];
      group.updateMatrixWorld(true); group.traverse(mesh => { if (mesh.isMesh) roles.push(mesh.userData.role); });
      const hole = new THREE.Raycaster(new THREE.Vector3(0, 20, 500), new THREE.Vector3(0, 0, -1)).intersectObject(group, true).length;
      return { technique: group.userData.technique, roles, hole };
    });
    assert.equal(geometry.technique, 'ai-parts'); assert.equal(geometry.roles.length, descriptor.parts.length); assert.equal(geometry.hole, 0);
    for (const [role, hex, finish] of [['body', '#246853', 'wood'], ['fronts', '#563294', 'matte'], ['top', '#b32d45', 'stone']]) {
      await page.fill('#' + role + 'Hex', hex); await page.locator('#' + role + 'Hex').press('Tab');
      await page.selectOption('#' + role + 'Finish', finish); await settle(page);
      const material = await page.evaluate(r => {
        const found = []; FormaConfigurator.getScene().getObjectByName('photo').traverse(mesh => { if (mesh.isMesh && mesh.userData.role === r) found.push({ color: mesh.material.color.getHexString(), texture: !!mesh.material.map }); }); return found;
      }, role);
      assert(material.length && material.every(item => item.color === hex.slice(1) && item.texture === (finish !== 'matte')));
    }
    const dimensions = { width: 185, height: 92, depth: 75 };
    for (const [key, value] of Object.entries(dimensions)) { await page.fill('#size-' + key, String(value)); await page.locator('#size-' + key).press('Tab'); await settle(page); }
    const measured = await page.evaluate(() => {
      const group = FormaConfigurator.getScene().getObjectByName('photo'); group.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(group); return { extent: bounds.getSize(new THREE.Vector3()).toArray(), bottom: bounds.min.y, metrics: FormaConfigurator.getMetrics() };
    });
    assert.deepEqual(measured.metrics, dimensions);
    [185, 92, 75].forEach((n, i) => assert(Math.abs(measured.extent[i] - n) < 1e-5)); assert(Math.abs(measured.bottom) < 1e-5);
    const exportPromise = page.waitForEvent('download'); await page.click('#saveBtn');
    const exported = await exportPromise, exportPath = path.join(QA, 'ai-project.json'); await exported.saveAs(exportPath);
    const project = JSON.parse(fs.readFileSync(exportPath, 'utf8'));
    assert.equal(project.configuration.photo.descriptor.version, 2);
    assert(project.configuration.photo.thumbnail.startsWith('data:image/jpeg;base64,'));
    assert.deepEqual(project.configuration.sizes.photo, dimensions);
    await assertNoStoredCredentials(project);
    current = await state(page);
    await page.click('[data-model="bar"]'); await settle(page);
    await page.setInputFiles('#projectFile', exportPath); await settle(page); assert.deepEqual(await state(page), current);
    const beforeReload = calls.length; await page.reload(); await ready(page); await settle(page);
    assert.deepEqual(await state(page), current); assert.equal(calls.length, beforeReload, 'Reload restores saved geometry without contacting AI');
    await assertNoStoredCredentials(project);
    await page.screenshot({ path: path.join(QA, 'ai-model-desktop.png') });

    await open(); await upload(page); await idle(page);
    const invalid = copy(descriptor); invalid.parts[0].size.x = 0;
    await generateError({ kind: 'success', descriptor: invalid }, 'invalide');
    await generateError({ kind: 'success', descriptor: { ...copy(descriptor), kind: 'unsupported', reason: 'Imaginea nu conține mobilier.', parts: [] } }, 'nu conține mobilier');
    await generateError({ kind: 'error', status: 429, code: 'rate_limit', message: 'Limita furnizorului a fost atinsă. Încearcă mai târziu.' }, 'Limita furnizorului');
    await generateError({ kind: 'network' }, 'Conexiunea la server');
    await generateError({ kind: 'error', status: 401, code: 'session_expired', message: 'Sesiunea AI a expirat. Conectează-te din nou.' }, 'expirat', false);
    assert.equal(await page.locator('#aiConnection').getAttribute('data-connected'), 'false');
    assert(await page.locator('#aiKeyRow').isVisible());
    connectionFailure = { code: 'invalid_credentials', message: 'Cheia API nu este validă.' };
    await page.fill('#aiKey', SECRET); await page.click('#aiConnect'); await idle(page);
    assert((await page.textContent('#photoStatus')).includes('nu este validă')); assert.equal(await page.inputValue('#aiKey'), '');
    await assertNoStoredCredentials(); connectionFailure = null;
    await connect('gemini', GEMINI_SECRET);
    generation = { kind: 'success', descriptor: { ...copy(descriptor), name: 'Masă creată cu Gemini' } };
    await page.click('#photoGenerate'); await page.waitForFunction(() => FormaConfigurator.getState().photo.name === 'Masă creată cu Gemini'); await settle(page);
    await open();
    const beforeDisconnect = await state(page); await page.click('#aiDisconnect'); await idle(page);
    assert.deepEqual(await state(page), beforeDisconnect); assert(await page.locator('#photoGenerate').isDisabled());
    assert(await page.locator('#aiDisconnect').isHidden()); await assertNoStoredCredentials();

    await connect('gemini', GEMINI_SECRET); generation = { kind: 'hold' };
    const beforeCancel = await state(page), priorGenerations = calls.filter(call => call.operation === 'generate').length;
    await page.click('#photoGenerate');
    await page.waitForFunction(() => document.querySelector('#photoDialog').getAttribute('aria-busy') === 'true');
    await new Promise((resolve, reject) => {
      const deadline = Date.now() + 5000;
      const check = () => heldRoute ? resolve() : Date.now() >= deadline ? reject(new Error('The cancellable generation request was not dispatched')) : setTimeout(check, 10); check();
    });
    assert.equal(calls.filter(call => call.operation === 'generate').length, priorGenerations + 1);
    await page.click('#photoClose'); await idle(page);
    await heldRoute.fulfill({ contentType: 'application/json', body: JSON.stringify({ descriptor: { ...copy(descriptor), name: 'Stale response must never apply' } }) }).catch(() => {});
    heldRoute = null; await settle(page);
    assert.deepEqual(await state(page), beforeCancel, 'Closing an in-flight generation prevents a stale result replacing the model');
    assert(await page.locator('#photoDialog').isHidden());

    await page.click('#themeToggle');
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
    await page.setViewportSize({ width: 390, height: 844 }); await open();
    const dialogBox = await page.locator('#photoDialog').boundingBox();
    assert(dialogBox.x >= 0 && dialogBox.x + dialogBox.width <= 391 && dialogBox.y >= 0 && dialogBox.y + dialogBox.height <= 845, 'AI dialog stays inside the mobile viewport');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const styles = await page.locator('#photoDialog').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }));
    assert.notEqual(styles.background, 'rgb(255, 255, 255)'); assert.notEqual(styles.background, styles.color);
    assert(styles.scrollWidth <= styles.clientWidth + 1, 'AI controls do not overflow their mobile dialog');
    await page.screenshot({ path: path.join(QA, 'ai-dialog-dark-mobile.png'), fullPage: true });
    await page.locator('#aiDisconnect').scrollIntoViewIfNeeded(); await page.click('#aiDisconnect'); await idle(page);
    await page.keyboard.press('Escape'); await idle(page);
    session.configured = false; await open();
    assert(await page.locator('#aiKey').isDisabled()); assert(await page.locator('#aiConnect').isDisabled()); assert(await page.locator('#photoGenerate').isDisabled());
    assert.equal(await page.locator('#photoStatus').getAttribute('data-kind'), 'error');
    await assertNoStoredCredentials(project);

    const offline = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    await offline.setOffline(true);
    const filePage = await offline.newPage(); watch(filePage);
    const offlineNetwork = []; filePage.on('request', request => { if (/^https?:/.test(request.url())) offlineNetwork.push(request.url()); });
    await filePage.goto(pathToFileURL(HTML).href); await ready(filePage); await filePage.click('#photoUploadBtn');
    assert((await filePage.textContent('#photoStatus')).includes('necesită un server'));
    assert(await filePage.locator('#aiConnect').isDisabled()); assert(await filePage.locator('#photoGenerate').isDisabled());
    await filePage.setInputFiles('#projectFile', exportPath); await settle(filePage);
    assert.equal((await state(filePage)).photo.descriptor.version, 2, 'Generated projects can be loaded offline');
    assert.deepEqual(offlineNetwork, []); await offline.close();
    assert(calls.filter(call => call.operation === 'connect').some(call => call.body.provider === 'gemini'));
    assert(calls.every(call => call.operation === 'connect' || !JSON.stringify(call).includes(SECRET)));
    assert.deepEqual(unexpectedRequests, [], 'All tests use local fixtures and mocked API responses only');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, paidProviderCalls: 0, explicitUploadAndGeneration: true, imageReencodedAndResized: true, bothProviders: true, realEditableGeometry: true, credentialsExcludedFromPersistence: true, projectRoundTripAndReload: true, retryAndExpiry: true, staleResponseIgnored: true, darkMobile: true, staticOfflineGuidance: true, pageErrors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(QA, 'ai-ui-failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    if (heldRoute) await heldRoute.abort().catch(() => {});
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
