# Meshuttle UI Design System

This file is the visual source of truth for the Windows client. Page-specific files under `pages/` may override it.

## Product character

- Product: cross-device private file and text transfer utility
- Style: compact dark desktop application, calm and technical without looking cyberpunk
- Brand idea: a shuttle moving through a resilient mesh
- Primary language: Simplified Chinese; English appears only in the wordmark and small eyebrow labels

## Colors

| Role | Value |
| --- | --- |
| Application background | `#0B0D10` |
| Sidebar | `#101318` |
| Main surface | `#15191F` |
| Raised surface | `#1B2027` |
| Border | `#303741` |
| Primary text | `#F5F7FA` |
| Muted text | `#9BA4AF` |
| Brand / primary action | `#F4B942` |
| Online state | `#41D3BD` |
| Destructive action | `#F06A63` |

Amber is the only general-purpose accent. Teal is reserved for confirmed online states; red is reserved for destructive or failed states.

## Typography

Use local Windows fonts only so the packaged client works offline:

```css
font-family: "Segoe UI Variable", "Microsoft YaHei UI", "Segoe UI", sans-serif;
```

- Window title: 25–27 px, bold
- Section title: 13–15 px, bold
- Body and controls: 9–12 px depending on window density
- Minimum body contrast: WCAG AA

## Shape and spacing

- Main cards: 14–16 px radius
- Inputs and buttons: 7–9 px radius
- Small cards and list rows: 8–11 px radius
- Base spacing scale: 4, 6, 8, 10, 12, 16, 20, 24, 32 px
- Borders are 1 px; shadows are restrained and never replace borders

## Interaction rules

- Every button has a visible label or an icon plus screen-reader text, title, and accessible name.
- Every async button disables itself and changes its label while work is running.
- Destructive actions require confirmation immediately before deletion.
- Empty, loading, offline, success, and error states always contain explanatory text.
- All keyboard-focusable controls have a visible 2 px amber focus ring.
- Hover uses color, border, or background changes without scaling or layout shift.
- Respect `prefers-reduced-motion`.

## Window-specific structure

### Main window

- Fixed 220 px sidebar with brand, navigation, connection state, version, license, and author
- Main column with header status, drag area, complete text/file toolbar, text composer, and selectable item list
- Batch actions stay disabled until their requirements are met

### Floating window

- Always-on-top compact window
- Standard labeled window actions exposed to accessibility APIs
- Connection state, drag area, explicit “添加文字” and “选择文件” actions, plus quick text input

### Setup window

- Three equally weighted modes: remote server, local host, and device mesh
- Forms use persistent labels rather than placeholder-only fields
- Security and availability boundaries are shown next to the relevant action

## Forbidden patterns

- Emoji as UI icons
- Empty, ellipsis-only, or unlabeled buttons
- Purple/neon gradients, oversized marketing headlines, decorative charts
- Invisible disabled states or silent failures
- Remote web fonts or assets required for the application to render
