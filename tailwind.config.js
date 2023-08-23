/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./er.html",
    "./er.ts",
    "./interact.html",
    "./interact.tsx",
    "./form.tsx",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./component/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/forms')
  ],
}

