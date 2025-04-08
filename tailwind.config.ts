import type { Config } from "tailwindcss";

// Config is minimal now, relying on @theme in CSS
const config: Config = {
  content: [
    // Paths to all template files
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Theme customizations are now primarily in globals.css via @theme
  theme: {
    extend: {
        // We keep extend empty for now, unless needed for specific plugin overrides
        // or complex variants not covered by CSS-first approach.
    },
  },
  plugins: [],
};
export default config; 