const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const html = path.join(__dirname, 'configurator-mobilier.html');
const MAX_API_BODY = 7 * 1024 * 1024;

function localEnvironment() {
  const env = { ...process.env };
  const filename = path.join(__dirname, '.dev.vars');
  if (fs.existsSync(filename)) {
    for (const line of fs.readFileSync(filename, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*(AI_SESSION_SECRET|OPENAI_MODEL|GEMINI_MODEL)\s*=\s*(.*?)\s*$/);
      if (!match || env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      env[match[1]] = value;
    }
  }
  return env;
}

(async () => {
  const { handleAIRequest } = await import('./server/ai.mjs');
  const env = localEnvironment();
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || '127.0.0.1'}`);
      if (url.pathname.startsWith('/api/')) {
        const controller = new AbortController();
        request.on('aborted', () => controller.abort());
        response.on('close', () => { if (!response.writableEnded) controller.abort(); });
        const chunks = []; let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > MAX_API_BODY) {
            response.writeHead(413, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ error: { code: 'too_large', message: 'Imaginea depășește dimensiunea permisă.' } }));
            return;
          }
          chunks.push(chunk);
        }
        const input = new Request(url, { method: request.method, headers: request.headers,
          ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(chunks) }), signal: controller.signal });
        const result = await handleAIRequest(input, env, { crypto: webcrypto });
        response.writeHead(result.status, Object.fromEntries(result.headers));
        response.end(Buffer.from(await result.arrayBuffer()));
        return;
      }
      if (url.pathname !== '/' && url.pathname !== '/configurator-mobilier.html') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      fs.createReadStream(html).pipe(response);
    } catch {
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ error: { code: 'invalid_request', message: 'Cererea nu a putut fi citită.' } }));
    }
  });
  const port = process.env.PORT === undefined ? 0 : Number(process.env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT trebuie să fie între 0 și 65535.');
  server.listen(port, '127.0.0.1', () => console.log('http://127.0.0.1:' + server.address().port + '/configurator-mobilier.html'));
})().catch(() => { console.error('Serverul local nu a pornit. Verifică versiunea Node și configurația proiectului.'); process.exitCode = 1; });
