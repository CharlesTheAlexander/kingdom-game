import { defineConfig } from 'vite';
import checker from 'vite-plugin-checker';

// TypeScript migration in progress (allowJs: true). vite-plugin-checker runs the
// TS compiler in a worker so type errors surface in dev overlay and fail the build.
export default defineConfig({
  plugins: [
    checker({
      typescript: true,
    }),
  ],
});
