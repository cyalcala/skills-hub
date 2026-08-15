import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Cloudflare's Pages publisher evaluates generated modules in a validation
// environment that does not expose MessageChannel, even though the configured
// Workers runtime does. React DOM Server constructs one at module load, so
// every server chunk needs this validation-only fallback installed before
// imports are evaluated. The runtime's native implementation always wins.
//
// Carried over from cyalcala/va-freelance-hub, where its absence broke Pages
// deploys that built fine locally. Remove only after confirming a deploy
// succeeds without it.
const pagesMessageChannelFallback = `
if (typeof globalThis.MessageChannel === 'undefined') {
  class MessageChannel {
    constructor() {
      this.port1 = { postMessage: () => {}, onmessage: null };
      this.port2 = { postMessage: () => {}, onmessage: null };
    }
  }
  globalThis.MessageChannel = MessageChannel;
}
`;

export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
  integrations: [react(), tailwind()],
  vite: {
    plugins: [
      {
        name: 'pages-messagechannel-compat',
        apply: 'build',
        generateBundle(_options, bundle) {
          for (const [fileName, chunk] of Object.entries(bundle)) {
            if (chunk.type === 'chunk' && fileName.endsWith('.mjs')) {
              chunk.code = `${pagesMessageChannelFallback}\n${chunk.code}`;
            }
          }
        },
      },
    ],
  },
});
