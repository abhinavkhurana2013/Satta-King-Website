import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'market-chart-rewrite',
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            const rawUrl = req.url || '';
            const pathOnly = rawUrl.split('?')[0];
            if (
              pathOnly &&
              pathOnly !== '/' &&
              pathOnly !== '/index.html' &&
              pathOnly !== '/chart.html' &&
              pathOnly !== '/new-ghaziabad.html' &&
              !pathOnly.startsWith('/src') &&
              !pathOnly.startsWith('/@') &&
              !pathOnly.startsWith('/node_modules') &&
              !pathOnly.startsWith('/assets') &&
              !pathOnly.startsWith('/public') &&
              !pathOnly.includes('.')
            ) {
              const query = rawUrl.includes('?') ? rawUrl.substring(rawUrl.indexOf('?')) : '';
              const targetHtmlFile = path.resolve(__dirname, pathOnly.substring(1) + '.html');
              import('fs').then(fs => {
                if (fs.existsSync(targetHtmlFile)) {
                  req.url = `/${pathOnly.substring(1)}.html` + query;
                } else {
                  req.url = '/chart.html' + query;
                }
                next();
              }).catch(() => {
                req.url = '/chart.html' + query;
                next();
              });
              return;
            }
            next();
          });
        }
      }
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          main: path.resolve(__dirname, 'index.html'),
          chart: path.resolve(__dirname, 'chart.html'),
          newGhaziabad: path.resolve(__dirname, 'new-ghaziabad.html'),
          disawer: path.resolve(__dirname, 'disawer.html'),
          disawar: path.resolve(__dirname, 'disawar.html'),
          dehliNoon: path.resolve(__dirname, 'dehli-noon.html'),
          delhiNoon: path.resolve(__dirname, 'delhi-noon.html'),
          punjabDay: path.resolve(__dirname, 'punjab-day.html'),
          faridabad: path.resolve(__dirname, 'faridabad.html'),
          newFaridabad: path.resolve(__dirname, 'new-faridabad.html'),
          gaziabad: path.resolve(__dirname, 'gaziabad.html'),
          ghaziabad: path.resolve(__dirname, 'ghaziabad.html'),
          newGaziabad: path.resolve(__dirname, 'new-gaziabad.html'),
          newGhaziabadChart: path.resolve(__dirname, 'new-ghaziabad-chart.html'),
          gali: path.resolve(__dirname, 'gali.html'),
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
