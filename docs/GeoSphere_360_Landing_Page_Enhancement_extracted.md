GeoSphere 360 — Landing Page Enhancement

Meridian-inspired premium landing page specification for Antigravity IDE

1. Goal

Enhance only the public GeoSphere 360 landing page using the visual quality, composition, typography, spacing, motion, and premium editorial feel of the ThreeUI Meridian landing page as inspiration.

Reference: https://threeui.com/landing-pages/meridian-page

Do NOT clone Meridian. Create an original GeoSphere 360 identity combining GIS, engineering, surveying, mobile mapping, 360 imagery, and advanced technology.

2. Critical Preservation Rules

Before coding, inspect the existing architecture, global theme/design system, routing, Guest application, landing-page components, assets, WebGIS components, and 360 components. Reuse existing components where practical.

Do not rewrite the entire application.

Do not replace or break the existing WebGIS application.

Do not break Guest mode or authentication.

Do not change existing application routes.

Do not remove existing functionality.

Do not replace or duplicate the existing global theme package.

Do not change backend/API, GIS, processing, dashboard, or 360 viewer functionality.

Do not remove dependencies without a clear reason.

Only redesign/enhance the public landing page unless a very small supporting change is absolutely necessary.

All existing application functionality must remain intact.

3. Product Positioning

Position GeoSphere 360 as a professional mobile mapping and geospatial operations platform, not a generic SaaS dashboard.

360° mobile mapping

GIS/WebGIS

Mapping operations

Data processing

Trajectory management

360 imagery

Spatial visualization

Processing monitoring

Dataset management

QA/QC

Operational intelligence

Data delivery/export

4. Visual Direction

Use Meridian as inspiration for large editorial typography, generous whitespace, thin architectural lines, premium enterprise aesthetics, cinematic imagery, subtle motion, layered composition, precise alignment, strong visual rhythm, and elegant transitions.

Avoid generic startup gradients, excessive glassmorphism, excessive rounded cards, generic AI/SaaS aesthetics, excessive shadows, stock-photo appearance, overly colourful dashboards, and template-like sections.

The final result must feel like GeoSphere 360, not Meridian.

5. Hero Section

Create a dramatically stronger cinematic hero.

Brand: GEOSPHERE 360

Headline direction: THE OPERATING SYSTEM FOR MOBILE MAPPING.

Supporting message: Capture. Process. Inspect. Understand.

Visual language: interactive map, 360 imagery preview, mobile-mapping trajectory, GNSS points, spatial grid, coordinate information, camera position, and subtle processing indicators.

The hero should visually communicate a live geospatial operations environment rather than only showing text.

6. Hero CTAs

Primary: ENTER OPERATIONS HUB — use the existing Guest/application route. Never create a fake route.

Secondary: EXPLORE PLATFORM — scroll to the platform overview.

7. Platform Overview

Use a strong editorial statement such as: ONE PLATFORM. EVERY STAGE OF THE MAPPING WORKFLOW.

Show the workflow: Capture → Process → Inspect → Analyse → Deliver. Prefer an elegant visual sequence over a basic feature-card grid.

8. 360 Mobile Mapping

Make 360 mapping a signature feature.

Suggested headline: SEE THE WORLD FROM EVERY FRAME.

360 panorama

Map location

Camera position

Trajectory

Direction/heading

Image metadata

Create a visual relationship between map and 360 imagery. Reuse existing components/assets safely; do not duplicate the actual application viewer unnecessarily.

9. Geospatial Operations

Show Map + Data + Operations.

WebGIS

Spatial layers

Trajectory

Dataset visualization

Feature inspection

Location-based information

Use a sophisticated map-inspired composition.

10. Processing

Show an elegant production pipeline: INGEST → VALIDATE → PROCESS → QA / QC → PUBLISH → DELIVER.

Use subtle viewport animation. It should feel like geospatial production, not a generic software development pipeline.

11. Operations Hub

Show a visually strong preview of the actual GeoSphere 360 application.

Suggested headline: FROM RAW DATA TO OPERATIONAL INTELLIGENCE.

Use existing UI where possible so visitors understand this is a real working WebGIS.

12. Data / QA / Delivery

Introduce dataset management, processing status, QA/QC, review, export, and deliverables. Use a sophisticated data-oriented visual instead of generic feature cards.

13. Final CTA

Suggested headline: READY TO EXPLORE THE MAPPING WORKFLOW?

ENTER GEOSPHERE 360

VIEW PLATFORM

Use the existing application route.

14. Navigation

Left: GEOSPHERE 360

Navigation: Platform, 360 Mapping, Processing, Operations

Right: ENTER HUB ↗

Make navigation minimal, sticky/compact on scroll, readable, responsive, and consistent with the existing global theme.

15. Typography

Use the existing typography system where possible. Prioritize large display typography, strong hierarchy, readable heading line-height, technical metadata typography, and monospace styling for coordinates/status/data where appropriate. Do not introduce unnecessary fonts.

16. Colour

Use the existing GeoSphere global theme. Do not create an unrelated palette.

Use the existing accent sparingly for trajectories, active states, coordinates, important controls, CTA, and data indicators. Keep the overall page restrained and premium.

17. Motion

Page-load reveal

Text/image reveal

Subtle parallax

Map movement

Line/trajectory animation

Scroll-triggered transitions

Hover states

Navigation transitions

Motion should communicate precision, movement, spatial data, and technology. Avoid excessive animation and respect prefers-reduced-motion.

18. Responsive Design

Do not simply shrink desktop. Create intentional desktop, tablet, and mobile layouts.

Desktop: large cinematic map/360/data composition.

Tablet: simplified composition while preserving hierarchy.

Mobile: prioritize brand → headline → CTA → 360/map visual → core capabilities → workflow.

Do not overcrowd mobile screens.

19. Performance

Lazy-load assets

Optimize images

Prefer CSS transforms for animation

Avoid unnecessary JavaScript animation loops

Avoid large new dependencies

Reuse existing components

Do not load the entire WebGIS application before the user enters it

The landing page must not make the Operations Hub slower.

20. Accessibility

Keyboard navigation

Visible focus states

Good contrast

Semantic HTML

Accessible buttons/navigation

Reduced-motion support

Appropriate ARIA labels

21. Implementation Workflow

Inspect the repository and existing architecture.

Identify the landing page, global theme, reusable components, assets, routing, WebGIS components, and 360 components.

Reuse existing components wherever practical.

Implement the new landing page within the existing architecture.

Connect CTA to the existing Guest/application route.

Test all existing application routes after the redesign.

Check desktop, tablet, mobile, accessibility, performance, and route integrity.

22. UX Questions the Landing Page Must Answer

What is this? — A mobile mapping and geospatial operations platform.

What does it do? — Capture, process, visualize and manage spatial/360 data.

Why is it different? — It connects GIS, mobile mapping, 360 imagery and operational processing in one environment.

What can I do? — Enter the Operations Hub and work with the data.

23. Final Quality Bar

Do not stop at 'the landing page looks nicer.' The target is: 'This looks like a real commercial geospatial technology product.'

Compare the result against Meridian for visual hierarchy, spacing, typography, composition, motion, premium feel, section transitions, and responsive behaviour, while maintaining a distinct GeoSphere 360 identity.

Before finishing, review and fix visual inconsistencies, broken links/routes, accidental functionality changes, mobile problems, unnecessary animations, performance problems, and duplicated styling that should use the existing global theme.