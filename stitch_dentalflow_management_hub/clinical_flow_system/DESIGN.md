---
name: Clinical Flow System
colors:
  surface: '#f9f9fc'
  surface-dim: '#dadadc'
  surface-bright: '#f9f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f3f3f6'
  surface-container: '#eeeef0'
  surface-container-high: '#e8e8ea'
  surface-container-highest: '#e2e2e5'
  on-surface: '#1a1c1e'
  on-surface-variant: '#3c4a47'
  inverse-surface: '#2f3133'
  inverse-on-surface: '#f0f0f3'
  outline: '#6b7a77'
  outline-variant: '#bacac6'
  surface-tint: '#006a61'
  primary: '#006a61'
  on-primary: '#ffffff'
  primary-container: '#00c6b6'
  on-primary-container: '#004d46'
  inverse-primary: '#3bdccc'
  secondary: '#795271'
  on-secondary: '#ffffff'
  secondary-container: '#fdcbf1'
  on-secondary-container: '#7a5272'
  tertiary: '#3d608a'
  on-tertiary: '#ffffff'
  tertiary-container: '#90b3e1'
  on-tertiary-container: '#1f456d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#62f9e8'
  primary-fixed-dim: '#3bdccc'
  on-primary-fixed: '#00201d'
  on-primary-fixed-variant: '#005049'
  secondary-fixed: '#ffd7f4'
  secondary-fixed-dim: '#e8b8dd'
  on-secondary-fixed: '#2f0f2b'
  on-secondary-fixed-variant: '#5f3b59'
  tertiary-fixed: '#d2e4ff'
  tertiary-fixed-dim: '#a6c9f8'
  on-tertiary-fixed: '#001c37'
  on-tertiary-fixed-variant: '#234970'
  background: '#f9f9fc'
  on-background: '#1a1c1e'
  surface-variant: '#e2e2e5'
typography:
  headline-xl:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Hanken Grotesk
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: Hanken Grotesk
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  gutter: 16px
  margin-mobile: 16px
  margin-desktop: 32px
---

## Brand & Style

This design system is built for clinical efficiency and patient-centered care. The personality is **Professional, Approachable, and Systematic**. It prioritizes clarity and speed of information processing, evoking a sense of calm and organized competence.

The aesthetic follows a **Corporate Modern** style with a focus on "self-explaining" interfaces. Inspired by high-utility tools like Slack, the UI uses distinct tonal regions, generous whitespace, and purposeful color application to guide the user's eye without cognitive overhead. High-contrast elements and crisp borders ensure accessibility and readability in fast-paced dental environments.

## Colors

The palette is derived from the brand's core identity, balanced for a clinical software environment.

*   **Primary (Teal):** Used for primary actions, success states, and brand presence. It signifies health and precision.
*   **Secondary (Soft Pink/Purple):** Used sparingly for highlighting specific patient-centric features, reminders, or soft calls to action.
*   **Surface & Neutrals:** We use a "Clinical White" (#FCFDFF) for main workspaces and a "Sidebar Grey" (#F0F2F5) for navigational layers to create clear information architecture.
*   **Semantic Colors:** Red (#D32F2F) for urgent clinical alerts; Amber (#FFA000) for pending labs/schedules.

Maintain high contrast ratios (minimum 4.5:1) for all instructional text.

## Typography

**Hanken Grotesk** is the sole typeface for this design system, chosen for its exceptional legibility and modern, precise character. 

*   **Hierarchy:** Use `Headline-XL` and `LG` exclusively for dashboard overviews or patient profile headers. 
*   **Utility:** `Body-MD` is the workhorse for patient notes and clinical records.
*   **Contextual Labels:** Use `Label-MD` in all-caps with the specified letter spacing for section headers within sidebars or small metadata (e.g., "LAST VISIT", "DOB").
*   **Self-Explaining UI:** Pair `Title-MD` with `Body-MD` in help-text tooltips to provide immediate context for complex dental terminology.

## Layout & Spacing

The layout utilizes a **Fixed-Fluid Hybrid** grid. Sidebars and navigation drawers are fixed width (260px for navigation, 320px for patient details), while the central workspace is fluid to maximize the view of charts and schedules.

*   **Grid:** A 12-column grid on desktop, 4-column on mobile.
*   **Rhythm:** A strict 8px baseline grid is used. All vertical margins and paddings must be multiples of 8px.
*   **Density:** For clinical data tables, a "Compact" mode is allowed using 4px (XS) and 8px (Base) spacing to ensure maximum data visibility without scrolling.

## Elevation & Depth

To maintain the professional "Slack-like" feel, depth is communicated through **Tonal Layers** and **Low-contrast Outlines** rather than heavy shadows.

*   **Layer 0 (Background):** #F0F2F5 (Sidebar/Shell background).
*   **Layer 1 (Workspace):** #FFFFFF (Main content area).
*   **Layer 2 (Cards/Modals):** Raised via a subtle 1px border (#E1E4E8) and a soft, highly diffused ambient shadow (0px 4px 12px rgba(0, 0, 0, 0.05)).
*   **Active States:** Interactive elements like buttons use a slight inner shadow when pressed to provide tactile feedback.

## Shapes

In alignment with the "Central Dental" logo's soft curves, this design system uses a **Rounded** shape language.

*   **Standard Corners:** 8px (0.5rem) for buttons, input fields, and standard cards.
*   **Container Corners:** 16px (1rem) for large modals and main workspace containers.
*   **Patient Avatars:** Always circular (100% radius) to differentiate human elements from UI controls.

## Components

### Buttons
*   **Primary:** Solid Teal (#00c6b6) with White text. 8px radius. Bold, 14px text.
*   **Secondary:** Ghost style with Teal border and Teal text.
*   **Tertiary:** Soft Pink/Purple (#d4a5c9) backgrounds for "Patient Action" buttons (e.g., "Send Care Plan").

### Input Fields
*   Outlined style with a 1px border. On focus, the border thickens to 2px Primary Teal with a subtle glow. Labels are always persistent above the field for clarity.

### Cards & Clinical Lists
*   Cards use white backgrounds and 1px light grey borders. Clinical lists (e.g., Treatment Plans) use alternating row stripes (Zebra striping) in #F8F9FA for better horizontal eye-tracking.

### Status Chips
*   Pill-shaped with light backgrounds and dark text. (e.g., "Confirmed" = Light Teal background, Dark Teal text).

### Navigation
*   A "Slack-like" left-hand sidebar with a dark neutral background (#1A1C1E) and high-contrast white text for active states. Use the Secondary Soft Pink for notification badges.