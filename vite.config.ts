import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Kennung dieses Baus. Sie wird in die App eingebacken und zusätzlich als
 * version.json neben die App gelegt, damit die laufende App merken kann, dass
 * inzwischen eine neuere veröffentlicht wurde.
 */
const buildId = new Date().toISOString();

/** Legt version.json in die Ausgabe. */
function versionFile(): Plugin {
  return {
    name: 'twomoons-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ buildId }),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: { host: true, port: 5173 },
  build: { outDir: 'dist', sourcemap: true },
});
