---
name: Clinical Flow
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#3f484a'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#6f797a'
  outline-variant: '#bfc8c9'
  surface-tint: '#20686f'
  primary: '#004349'
  on-primary: '#ffffff'
  primary-container: '#0d5c63'
  on-primary-container: '#90d2da'
  inverse-primary: '#8fd1d9'
  secondary: '#006a66'
  on-secondary: '#ffffff'
  secondary-container: '#84f2ec'
  on-secondary-container: '#006f6b'
  tertiary: '#004347'
  on-tertiary: '#ffffff'
  tertiary-container: '#065c61'
  on-tertiary-container: '#8ed2d7'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#abeef6'
  primary-fixed-dim: '#8fd1d9'
  on-primary-fixed: '#002023'
  on-primary-fixed-variant: '#004f55'
  secondary-fixed: '#87f4ee'
  secondary-fixed-dim: '#69d8d2'
  on-secondary-fixed: '#00201f'
  on-secondary-fixed-variant: '#00504d'
  tertiary-fixed: '#a9eef3'
  tertiary-fixed-dim: '#8ed2d7'
  on-tertiary-fixed: '#002022'
  on-tertiary-fixed-variant: '#004f53'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  display-lg:
    fontFamily: Hanken Grotesk
    fontSize: 36px
    fontWeight: '700'
    lineHeight: '1.2'
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: '1.3'
  headline-sm:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: '1.4'
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: '1.5'
  label-md:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1'
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.4'
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar-width: 260px
  container-max: 1440px
  gutter: 1.5rem
  unit-base: 4px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 24px
---

## Brand & Style

The design system is built for the high-stakes, high-detail environment of dental practice management. It merges the clinical precision required for medical records with the approachable, high-velocity communication patterns of modern SaaS platforms like Slack.

The visual style is **Corporate / Modern** with a focus on functional density. It avoids unnecessary decorative elements in favor of a "self-documenting" UI where hierarchy is established through purposeful typography and a disciplined use of color. The goal is to reduce cognitive load for office administrators and clinicians, creating an environment that feels organized, sterile yet welcoming, and inherently trustworthy.

## Colors

The palette is rooted in "Medical Teals" and "Professional Blues." 

- **Primary (#0D5C63):** A deep, authoritative teal used for the sidebar background and primary brand touchpoints, echoing the focus and stability of a clinical environment.
- **Secondary (#24A19C):** A vibrant, active teal used for primary actions (buttons, toggles) to draw the eye toward "next steps."
- **Tertiary (#6FB3B8):** A softer, illustrative blue-grey used for subtle accents, badges, and progress indicators.
- **Neutrals:** A range of soft greys (from #F8FAFC backgrounds to #1E293B text) ensures the interface feels airy and modern. Semantic colors for status (Schedule/Alerts) should use standard success/warning/error logic but desaturated to match the cool-toned palette.

## Typography

This design system utilizes a dual-font approach to balance personality and utility. 

- **Hanken Grotesk** is used for headlines and major UI anchors, providing a sharp, contemporary feel that distinguishes sections clearly.
- **Inter** is the workhorse for all body copy, data entry, and labels. It is chosen for its exceptional legibility at small sizes and its neutral, systematic character.

Special attention is paid to **data-mono** (Inter with tabular figures), ensuring that patient IDs, insurance codes, and time-slots align perfectly in dense table views.

## Layout & Spacing

The layout adopts a **Fixed Sidebar / Fluid Content** model, heavily inspired by modern workspace tools.

1.  **The Navigation Sidebar:** A 260px fixed-width column on the left containing high-level navigation, patient search, and "Channels" (Clinics/Specialties).
2.  **The Content Stage:** A fluid area that uses a 12-column grid. On desktop, margins are 24px; on mobile, these shrink to 16px.
3.  **Spacing Rhythm:** All spacing is based on a 4px baseline grid. Components use 8px (sm), 16px (md), and 24px (lg) increments to create a clear vertical rhythm.

**Responsive Behavior:** 
- **Desktop (>1024px):** Full sidebar and multi-column dashboards.
- **Tablet (768px - 1023px):** Sidebar collapses into an icon-only rail; content shifts to a 2-column or 1-column stack.
- **Mobile (<767px):** Sidebar is hidden behind a drawer; all content becomes a single-column vertical scroll with increased touch targets.

## Elevation & Depth

To maintain a "clean/clinical" feel, the design system avoids heavy shadows. Hierarchy is established through **Tonal Layers** and **Low-Contrast Outlines**.

- **Level 0 (Base):** Light grey (#F1F5F9) background for the entire application.
- **Level 1 (Surface):** Pure white (#FFFFFF) containers for cards, lists, and form areas. These are defined by a 1px border in #E2E8F0 rather than a shadow.
- **Level 2 (Popovers):** Modals and dropdown menus use a very soft, diffused shadow (0px 10px 15px -3px rgba(0, 0, 0, 0.05)) to suggest they are floating above the workspace.

This approach ensures the UI feels "flat" and efficient, preventing the "heavy" feeling that traditional skeuomorphic medical software often suffers from.

## Shapes

The shape language is **Rounded**, using a 0.5rem (8px) corner radius for most UI elements. This softens the technical nature of the CRM, making the software feel more approachable for patients and staff alike.

- **Standard Elements (Buttons, Inputs, Cards):** 8px (0.5rem).
- **Secondary Elements (Chips, Small Badges):** 4px (0.25rem).
- **Interactive UI (Sidebar Active State, Focus Rings):** Matches the container's radius.

## Components

### Buttons
Primary buttons use the Secondary Teal (#24A19C) with white text. Ghost buttons (outline only) are preferred for secondary actions like "Cancel" or "Export" to keep the visual field uncluttered.

### Input Fields
Inputs use a "floating label" style or a very clear top-aligned label. On focus, the border changes to the Primary Teal with a subtle 2px glow. Errors are highlighted with a 1px red border and a small supporting icon.

### Patient Feed (Slack-style)
The patient's history is presented as a chronological "feed." Each entry (appointment, note, x-ray upload) is a "message" block. This allows staff to quickly scroll through a patient's timeline as if reading a chat history.

### Status Chips
Used for appointment status (Confirmed, In-Chair, Completed). These use "Pill-shape" (rounded-full) geometry with low-saturation background tints and high-saturation text for maximum readability without visual noise.

### Cards
Cards are the primary container for data modules (Insurance Info, Treatment Plan). They have no shadow, a 1px light grey border, and a 16px internal padding. Headers within cards use a light grey background to separate them from the content.