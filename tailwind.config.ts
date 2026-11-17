import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: "hsl(var(--card))",
        border: "hsl(var(--border))",
        muted: "hsl(var(--muted))",
        primary: "hsl(var(--primary))",
        accent: "hsl(var(--accent))",
      },
      fontFamily: {
        sans: ["var(--font-cairo)", "Arial", "sans-serif"],
      },
      boxShadow: {
        soft: "0 12px 40px rgba(15, 23, 42, 0.06)",
      },
    },
  },
  plugins: [],
};

export default config;