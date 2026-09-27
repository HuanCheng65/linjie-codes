import basicSsl from '@vitejs/plugin-basic-ssl';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// `pnpm dev:https` 用自签名证书在局域网里开 HTTPS，手机才能拿到传感器数据。
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  worker: { format: 'es' },
  build: { target: 'es2022' },
}));
