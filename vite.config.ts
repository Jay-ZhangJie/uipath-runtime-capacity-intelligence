import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const uipathProxyPath = '/__uipath_orchestrator';

function isUiPathHttpsTarget(url: URL) {
  return url.protocol === 'https:' && (url.hostname === 'uipath.com' || url.hostname.endsWith('.uipath.com'));
}

export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'uipath-local-orchestrator-proxy',
      configureServer(server) {
        server.middlewares.use(uipathProxyPath, async (req, res) => {
          try {
            const requestUrl = new URL(req.url, 'http://localhost');
            const target = requestUrl.searchParams.get('target');
            if (!target) {
              res.statusCode = 400;
              res.end('Missing target URL.');
              return;
            }

            const targetUrl = new URL(target);
            if (!isUiPathHttpsTarget(targetUrl)) {
              res.statusCode = 403;
              res.end('Only HTTPS UiPath hosts are allowed.');
              return;
            }

            const headers = new Headers({ accept: 'application/json' });
            if (typeof req.headers.authorization === 'string') {
              headers.set('authorization', req.headers.authorization);
            }
            if (typeof req.headers['x-uipath-organizationunitid'] === 'string') {
              headers.set('x-uipath-organizationunitid', req.headers['x-uipath-organizationunitid']);
            }

            const upstream = await fetch(targetUrl, { headers });
            const body = Buffer.from(await upstream.arrayBuffer());
            res.statusCode = upstream.status;
            res.statusMessage = upstream.statusText;
            upstream.headers.forEach((value, key) => {
              const normalized = key.toLowerCase();
              if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(normalized)) {
                res.setHeader(key, value);
              }
            });
            res.end(body);
          } catch (error) {
            res.statusCode = 502;
            res.end(error instanceof Error ? error.message : String(error));
          }
        });
      },
    },
  ],
  optimizeDeps: {
    include: ['@uipath/uipath-typescript'],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@uipath/uipath-typescript')) return 'uipath-sdk';
          if (id.includes('react') || id.includes('react-dom')) return 'react-vendor';
          if (id.includes('lucide-react')) return 'icons';
          return 'vendor';
        },
      },
    },
  },
});
