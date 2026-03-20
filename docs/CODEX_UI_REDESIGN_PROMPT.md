You are redesigning the UI of a Tauri desktop app called OpsUI Meetings, a React and TypeScript internal meetings management tool.

This is a visual redesign. Preserve all behavior, data flow, and API contracts. Internal component markup and local component structure can be refactored as needed for the redesign, but functionality must remain identical.

Key rules:

- Preserve all existing features, workflows, and data integration.
- Prioritize desktop use. Minimum target width is 1280px.
- Do not introduce generic SaaS styling or UI-library defaults.
- Use raw CSS with CSS custom properties for the token system.
- Keep keyboard accessibility and visible focus states intact.
- Adapt the visual design to the existing architecture when a full structural rewrite would be risky.
- Work in phases:
  1. global tokens and typography
  2. shell, header, and sidebar
  3. meetings dashboard and detail panel
  4. remaining surfaces
  5. polish motion and states

Design direction:

- Style: industrial operational with editorial premium influence
- Mood: sharp, confident, technical, serious, slightly cinematic
- Theme: dark
- Color direction: true black surfaces, deep violet as primary interaction color, gold reserved for one high-consequence CTA
- Brand personality: elite operator

Visual system:

- Base surfaces:
  - `#0a0a0a`, `#111111`, `#161616`, `#1c1c1c`, `#222222`
- Borders:
  - subtle `#1e1e1e`
  - default `#2a2a2a`
  - bright `#383838`
- Text:
  - primary `#f0f0f0`
  - secondary `#888888`
  - muted `#4a4a4a`
- Accent:
  - violet `#6d28d9`
  - violet hover `#7c3aed`
  - violet dim `#4c1d95`
- Premium accent:
  - gold `#c9a227`
  - gold hover `#e2b93b`

Typography:

- Headings: Barlow Condensed, weights 600 to 800
- Body and UI: IBM Plex Sans, weights 300 to 600
- Data and labels: IBM Plex Mono, weights 400 to 500
- Headings should feel commanding and slightly condensed
- Body text should stay highly readable for dense operational use

Component language:

- Sharp corners, thin borders, solid panels
- Subtle gradients and restrained texture only
- No glassmorphism, no bloated shadows, no soft consumer-app feeling
- Status language should feel like an operations console

Layout:

- Fixed 48px header
- Fixed 220px sidebar
- Surface toolbar under the header
- Main content region for list, table, or calendar views
- Right detail panel for selected meeting context
- Current Meeting can have a more bespoke two-column layout

Component priorities:

- Meeting list rows should feel like engineered operational cards, not soft tiles
- Past meetings should be denser and table-like
- Detail panel should be crisp, sectional, and information-dense
- Admin should feel like an internal control surface, not a marketing dashboard
- Login should be stripped back, dark, and authoritative

Guardrails:

- Gold is used in one place only: the primary Meet CTA on the Current Meeting surface
- Do not remove outlines unless replaced with an explicit visible focus treatment
- Avoid feature additions unless the behavior already exists in code
- If an ideal design pattern conflicts with the existing logic, preserve logic and adapt the visuals
