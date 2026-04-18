/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        mist: '#d7e6f4',
        graphite: '#08111b',
        aqua: '#2dd4bf',
        cyanGlow: '#22d3ee',
      },
      boxShadow: {
        float: '0 20px 80px rgba(2, 8, 23, 0.45)',
      },
      borderRadius: {
        '4xl': '2rem',
      },
    },
  },
  plugins: [],
};
