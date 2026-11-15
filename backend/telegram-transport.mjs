import { request } from 'node:https';

/* Optional SSH tunnel to api.telegram.org:443. TLS still verifies Telegram's hostname. */
export function telegramTransport(tunnelPort = '') {
  if (!tunnelPort) return fetch;
  const port = Number(tunnelPort);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid Telegram tunnel port');
  return (url, options) => new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.hostname !== 'api.telegram.org' || target.port) return reject(new Error('Invalid Telegram endpoint'));
    const req = request({ hostname: '127.0.0.1', port, servername: 'api.telegram.org',
      path: target.pathname + target.search, method: options.method,
      headers: { ...options.headers, Host: 'api.telegram.org' }, signal: options.signal,
    }, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (chunk) => { size += chunk.length; if (size > 1024 * 1024) res.destroy(new Error('Telegram response too large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('end', () => resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode,
        json: async () => JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject); req.end(options.body);
  });
}
