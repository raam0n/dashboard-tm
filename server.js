const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 3000;
const ROOT_DIR = path.resolve(__dirname);

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://flagcdn.com https://backend.cdn.aoe2companion.com; connect-src 'self' https://data.aoe2companion.com",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer'
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let rawPath = (req.url || '/').split('?')[0];
  let reqPath;
  try {
    reqPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(403, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('403: Acceso denegado');
    return;
  }

  if (reqPath.includes('\0')) {
    res.writeHead(403, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('403: Acceso denegado');
    return;
  }

  if (reqPath === '/') reqPath = '/index.html';

  // Resolvemos la ruta absoluta y verificamos que permanezca estrictamente dentro de ROOT_DIR
  const filePath = path.resolve(ROOT_DIR, '.' + reqPath);
  const relative = path.relative(ROOT_DIR, filePath);
  const isInsideRoot =
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    filePath.startsWith(ROOT_DIR + path.sep);

  if (!isInsideRoot) {
    res.writeHead(403, {
      ...SECURITY_HEADERS,
      'Content-Type': 'text/plain; charset=utf-8'
    });
    res.end('403: Acceso denegado');
    return;
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const contentType = mimeTypes[extname] || 'application/octet-stream';

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        res.writeHead(404, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('404: Archivo no encontrado');
      } else {
        res.writeHead(500, {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/plain; charset=utf-8'
        });
        res.end('500: Error interno del servidor');
      }
    } else {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    }
  });
});

server.listen(PORT, () => {
  console.log('======================================================');
  console.log(`🚀 AOE2 Group Dashboard iniciado`);
  console.log(`🌐 Abriendo en navegador: http://localhost:${PORT}`);
  console.log('======================================================');
  exec(`start http://localhost:${PORT}`);
});
