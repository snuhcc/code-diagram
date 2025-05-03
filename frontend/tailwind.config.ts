// tailwind.config.ts
import type { Config } from 'tailwindcss';

export default <Config>{
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vscBg:     '#1e1e1e',
        vscPanel:  '#252526',
        vscBorder: '#3c3c3c',
        vscSide:   '#333337',
        vscAccent: '#569cd6',

        bg:     'var(--background)',
        fg:     'var(--foreground)',
        panel:  'var(--panel)',
        side:   'var(--side)',
        accent: 'var(--accent)',
        border: 'var(--border)',
      },
    },
  },
  plugins: [],
};
