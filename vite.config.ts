import { defineConfig } from 'vite';
import vinext from 'vinext';
import { nitro } from 'nitro/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const preset = mode === 'vercel'
    ? 'vercel'
    : mode === 'cloudflare' || process.env.WORKERS_CI === '1'
      ? 'cloudflare-module'
      : undefined;

  return {
    plugins: [tailwindcss(), vinext(), nitro(preset ? { preset } : {})],
  };
});
