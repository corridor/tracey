// THROWAWAY spike. usage: APP=solid|preact|vanilla vite build -c shell/vite.config.mjs
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import preact from '@preact/preset-vite'
import path from 'node:path'
const app = process.env.APP
export default defineConfig({
  root: path.resolve(import.meta.dirname, app),
  base: './',
  plugins: app === 'solid' ? [solid()] : app === 'preact' ? [preact()] : [],
  build: { outDir: path.resolve(import.meta.dirname, '../dist/shell', app), emptyOutDir: true, minify: 'esbuild', target: 'es2022', modulePreload: { polyfill: false } },
})
