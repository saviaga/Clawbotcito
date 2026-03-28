const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8080;
const API_PORT = 8181;
const BLOG_DIR = '/home/node/.openclaw/workspace/blog';

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Proxy /api/* to the API server
  if (url.startsWith('/api/')) {
    const proxy = http.request({ hostname: '127.0.0.1', port: API_PORT, path: url, method: 'GET' }, proxyRes => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on('error', () => {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API server unavailable' }));
    });
    proxy.end();
    return;
  }

  // Serve static files from blog directory
  let filePath = path.join(BLOG_DIR, url === '/' ? 'index.html' : url);
  
  // Handle directory URLs (add index.html)
  if (filePath.endsWith('/')) filePath += 'index.html';
  try {
    if (fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch(e) {}

  // Resolve symlinks
  try { filePath = fs.realpathSync(filePath); } catch(e) {}

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy server on http://localhost:${PORT} (static + API proxy)`);
});
