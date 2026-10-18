import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { saydo } from 'saydo/vite';

// One plugin: finds capabilities/, saydo.routes.ts and saydo.config.ts, and serves /api/saydo in dev.
export default defineConfig({ plugins: [react(), saydo()] });
