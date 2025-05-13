// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default <Config>{
  content: [
  './src/**/*.{js,jsx,ts,tsx}',   // 기존
  './app/**/*.{js,jsx,ts,tsx}',   // Next.js 13+ app 디렉터리 사용 시
  './src/**/*.mdx',               // MDX 파일까지 스캔하려면
],
  theme: {
    extend: {
      colors: {
        surface:   'var(--panel)',
        backdrop:  'var(--background)',
        divider:   'var(--border)',
        accent:    'var(--accent)',
        primary:   'var(--foreground)',
        secondary: 'var(--side)',
      },
      boxShadow: {
        sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
      },
      borderRadius: {
        md: '0.5rem',
      },
    },
  },
  plugins: [],
};
