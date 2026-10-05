import { defineConfig } from 'vite';
import vinext from 'vinext';
import { nitro } from 'nitro/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => ({
  plugins: [
    tailwindcss(),
    vinext(),
    nitro(mode === 'vercel' ? { preset: 'vercel' } : {}),
  ],
}));
