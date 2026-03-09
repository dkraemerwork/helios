import type { Config } from 'tailwindcss';

export default {
  content: [
    './src/**/*.{html,ts}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        mc: {
          bg: '#0a0e14',
          panel: 'rgba(14, 20, 30, 0.95)',
          'panel-solid': '#0e141e',
          border: 'rgba(59, 130, 246, 0.15)',
          'border-hover': 'rgba(59, 130, 246, 0.3)',
          blue: '#3b82f6',
          'blue-hover': '#2563eb',
          'blue-light': '#60a5fa',
          amber: '#f59e0b',
          'amber-hover': '#d97706',
          emerald: '#10b981',
          'emerald-hover': '#059669',
          red: '#ef4444',
          'red-hover': '#dc2626',
          cyan: '#06b6d4',
          'cyan-hover': '#0891b2',
          purple: '#a855f7',
          'purple-hover': '#9333ea',
          text: '#e2e8f0',
          'text-dim': '#94a3b8',
          'text-muted': '#64748b',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'monospace',
        ],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-in': 'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
