---
name: Clinical Stream
colors:
  surface: '#F8FAFC'
  surface-dim: '#d1dbe9'
  surface-bright: '#f7f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#edf4ff'
  surface-container: '#e4effd'
  surface-container-high: '#dfe9f7'
  surface-container-highest: '#d9e3f1'
  on-surface: '#121c26'
  on-surface-variant: '#40484e'
  inverse-surface: '#27313c'
  inverse-on-surface: '#e8f2ff'
  outline: '#70787f'
  outline-variant: '#bfc7cf'
  surface-tint: '#00658e'
  primary: '#005578'
  on-primary: '#ffffff'
  primary-container: '#0b6e99'
  on-primary-container: '#cfeaff'
  inverse-primary: '#84cfff'
  secondary: '#006d2f'
  on-secondary: '#ffffff'
  secondary-container: '#95f8a5'
  on-secondary-container: '#007433'
  tertiary: '#6d4800'
  on-tertiary: '#ffffff'
  tertiary-container: '#8d5e00'
  on-tertiary-container: '#ffe2be'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#c7e7ff'
  primary-fixed-dim: '#84cfff'
  on-primary-fixed: '#001e2e'
  on-primary-fixed-variant: '#004c6c'
  secondary-fixed: '#95f8a5'
  secondary-fixed-dim: '#7adb8c'
  on-secondary-fixed: '#002109'
  on-secondary-fixed-variant: '#005322'
  tertiary-fixed: '#ffddb1'
  tertiary-fixed-dim: '#fbbb58'
  on-tertiary-fixed: '#291800'
  on-tertiary-fixed-variant: '#624000'
  background: '#f7f9ff'
  on-background: '#121c26'
  surface-variant: '#d9e3f1'
  canvas: '#FFFFFF'
  sidebar: '#F1F5F9'
  danger: '#C2352B'
  border: '#D7E0E8'
  text-muted: '#5C6B78'
  brand-teal: '#7BC8C3'
  brand-lavender: '#C196C2'
typography:
  page-title:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  section-title:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  base-body:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  dense-row:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-metadata:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 4px
  utility-rail: 56px
  sidebar-width: 272px
  sidebar-collapsed: 72px
  gutter: 16px
  margin-page: 24px
  control-std: 36px
  control-dense: 28px
---

## Brand & Style

This design system is a high-utility, high-density framework engineered for the precision-focused environment of dental management. It draws inspiration from Slack’s three-region architecture to create a "Clinical Stream" workflow, prioritizing persistent orientation and attention management over decorative aesthetics.

The visual style is **Corporate / Modern** with a lean toward **Minimalism**. It eschews shadows and gradients in favor of a "flat-first" philosophy where depth is communicated through distinct tonal layers and 1px structural borders. The emotional response is one of calm, fast-paced reliability—essential for practitioners handling patient care and financial billing simultaneously. 

Key brand characteristics from Central Dental—soft teals and purples—are integrated as subtle clinical markers and logo accents, ensuring the interface feels specialized for dentistry without sacrificing professional rigor.

## Colors

The palette is strictly semantic to prevent "alarm fatigue." The hierarchy uses a three-region background system: `--color-canvas` for active work areas, `--color-surface` for page context, and `--color-sidebar` for navigation.

- **Primary (#0B6E99):** Reserved for core actions and active navigation states.
- **Success (#16803C):** Indicates "Paid," "Confirmed," or "Completed" clinical statuses.
- **Warning (#9A6700):** Flags pending insurance or attention-required scheduling.
- **Danger (#C2352B):** Limited to overdue balances or clinical alerts/conflicts.
- **Brand Accents:** Subtle uses of Teal and Lavender from the Central Dental identity are permitted for patient-facing materials or non-functional illustrative accents.

## Typography

Typography is built on **Inter**, optimized for legibility in data-heavy views. 

**Rules for Clinical Data:**
- **Tabular Numerals:** Always use `font-variant-numeric: tabular-nums` for financial columns, time slots, and tooth numbers to ensure vertical alignment.
- **Casing:** Use sentence case for all interface labels. All-caps is restricted to the `label-caps` role for non-critical metadata.
- **Density:** The `dense-row` role is the primary vehicle for table-based workflows, allowing more patient data to be visible above the fold.

## Layout & Spacing

The layout utilizes a strict **4px base grid** with a fixed-to-fluid column model.

- **The Utility Rail (56px):** A permanent vertical anchor on the far left for high-level app switching.
- **The Context Sidebar (272px):** A secondary navigation tier that can collapse to an icon-only view (72px) to maximize workspace.
- **Main Workspace:** A fluid container that uses a 12-column grid for dashboard views or a single-column layout for clinical charts.

Margins are set to 24px for standard pages, while dense clinical lists reduce gutters to 8px or 12px to minimize eye travel.

## Elevation & Depth

This design system avoids traditional shadows to keep the UI feeling fast and "unweighted." 

- **Tonal Layering:** Depth is communicated by nesting surfaces. The sidebar (`#F1F5F9`) sits "below" the surface background (`#F8FAFC`), which in turn sits "below" the active work canvas (`#FFFFFF`).
- **One-Pixel Borders:** Use 1px solid borders (`--color-border`) to define card boundaries and table rows.
- **Floating Layers:** Shadows are only permitted for temporary overlays like dropdown menus or clinical modal dialogs. Use a soft, 12% opacity neutral shadow with a 16px blur for these instances.

## Shapes

The shape language is "Soft" (0.25rem / 4px - 6px) to maintain a professional, organized appearance.

- **Standard (6px):** Applied to buttons, input fields, and primary cards.
- **Overlays (8px):** Applied to dialogs and side-drawers.
- **Pills:** Strictly reserved for status chips (e.g., "Confirmed") and user avatars. Avoid pill-shaped buttons to maintain a clear distinction between actions and statuses.

## Components

- **Buttons:** 36px height for standard, 28px for dense. Use filled primary for the main action and outlined/ghost for secondary clinical tasks.
- **Input Fields:** 1px border with a 6px radius. Focus states should use a 2px primary-colored ring with a 2px offset.
- **Status Chips:** Small, pill-shaped indicators using low-saturation background tints of the semantic colors (e.g., Success-light background with Success-dark text).
- **Data Tables:** Use `dense-row` typography. Row hover states should use `--color-hover` (#E8F0F7). Selected rows use `--color-selected` (#DCEEF9).
- **Side Drawers:** Used for patient details; they should slide in from the right, overlaying the main workspace but leaving the Utility Rail accessible.
- **Iconography:** Use the Lucide set at 18px or 20px. Icons must always be paired with text in clinical contexts to ensure safety and clarity.