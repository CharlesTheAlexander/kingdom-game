import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

// TypeScript migration in progress (allowJs: true). vite-plugin-checker runs the
// TS compiler in a worker so type errors surface in dev overlay and fail the build.
//
// (V2 Phase 5) `base` is set so the built asset URLs resolve under the GitHub
// Pages project path https://<user>.github.io/kingdom-game/. All in-game art is
// generated procedurally at runtime, so there are no asset-file paths to break.
export default defineConfig({
  base: '/kingdom-game/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  plugins: [
    checker({
      typescript: true,
    }),
  ],
});
