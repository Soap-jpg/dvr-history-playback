import type { Config } from 'tailwindcss'

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "surface": "#0b1326",
        "on-tertiary-fixed": "#410005",
        "on-surface": "#dae2fd",
        "surface-container-low": "#131b2e",
        "on-tertiary-fixed-variant": "#842225",
        "on-secondary": "#68000a",
        "surface-container-lowest": "#060e20",
        "primary": "#4edea3",
        "inverse-surface": "#dae2fd",
        "on-error": "#690005",
        "outline": "#86948a",
        "primary-fixed-dim": "#4edea3",
        "on-tertiary": "#650911",
        "surface-container-highest": "#2d3449",
        "primary-container": "#10b981",
        "secondary-container": "#a40217",
        "background": "#0b1326",
        "error": "#ffb4ab",
        "on-primary": "#003824",
        "on-primary-container": "#00422b",
        "on-secondary-fixed-variant": "#930013",
        "on-primary-fixed": "#002113",
        "tertiary-fixed": "#ffdad7",
        "on-surface-variant": "#bbcabf",
        "on-secondary-container": "#ffaea8",
        "outline-variant": "#3c4a42",
        "on-secondary-fixed": "#410004",
        "on-error-container": "#ffdad6",
        "on-background": "#dae2fd",
        "secondary": "#ffb3ad",
        "secondary-fixed-dim": "#ffb3ad",
        "tertiary-container": "#fc7c78",
        "surface-bright": "#31394d",
        "surface-tint": "#4edea3",
        "on-tertiary-container": "#711419",
        "tertiary": "#ffb3af",
        "surface-container-high": "#222a3d",
        "error-container": "#93000a",
        "secondary-fixed": "#ffdad7",
        "surface-dim": "#0b1326",
        "surface-variant": "#2d3449",
        "tertiary-fixed-dim": "#ffb3af",
        "on-primary-fixed-variant": "#005236",
        "inverse-on-surface": "#283044",
        "primary-fixed": "#6ffbbe",
        "surface-container": "#171f33",
        "inverse-primary": "#006c49"
      },
      borderRadius: {
        DEFAULT: "0.125rem",
        lg: "0.25rem",
        xl: "0.5rem",
        full: "0.75rem"
      },
      spacing: {
        "container-padding": "1.5rem",
        "unit": "4px",
        "timeline-height": "120px",
        "gutter": "1rem",
        "sidebar-width": "280px"
      },
      fontFamily: {
        "headline-sm": ["Geist", "sans-serif"],
        "display-time": ["JetBrains Mono", "monospace"],
        "body-md": ["Inter", "sans-serif"],
        "label-caps": ["JetBrains Mono", "monospace"],
        "data-tabular": ["JetBrains Mono", "monospace"]
      },
      fontSize: {
        "headline-sm": ["18px", { "lineHeight": "1.4", "fontWeight": "600" }],
        "display-time": ["32px", { "lineHeight": "1.2", "letterSpacing": "-0.02em", "fontWeight": "600" }],
        "body-md": ["14px", { "lineHeight": "1.5", "fontWeight": "400" }],
        "label-caps": ["11px", { "lineHeight": "1", "fontWeight": "700" }],
        "data-tabular": ["13px", { "lineHeight": "1.4", "fontWeight": "400" }]
      }
    }
  },
  plugins: [],
} satisfies Config
