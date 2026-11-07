/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'aura-deep': '#f4f3f7',
        'aura-bg': '#ffffff',
        'aura-card': '#ffffff',
        'aura-card-2': '#f0edf7',
        'aura-elevated': '#f1eef8',
        'aura-border': '#e3dfeb',
        'aura-violet': '#7954c8',
        'aura-violet-light': '#7045b8',
        'aura-pink': '#9565cb',
        'aura-cyan': '#7954c8',
        'aura-gold': '#976100',
      },
      backgroundImage: {
        'aura-gradient': 'linear-gradient(135deg, #7954c8, #9565cb)',
        'aura-gradient-2': 'linear-gradient(135deg, #8a809d, #7954c8)',
        'aura-gradient-3': 'linear-gradient(135deg, #9565cb, #976100)',
        'aura-gradient-4': 'linear-gradient(135deg, #7954c8, #8a809d)',
      },
      boxShadow: {
        'aura-glow': '0 6px 20px rgba(0, 0, 0, 0.12)',
      },
    },
  },
  plugins: [],
}
