---
title: Web Agent Overview
---

# Web Agent Overview

Web Agent is a browser-embeddable AI assistant. It runs as an overlay, a chat
bubble, inside your web application. Use these pages to embed it, define the
tools it can call, and change how it looks.

## What Web Agent gives you

- **An embeddable chat UI**: a floating bubble interface built with Material Design concepts through Beer CSS.
- **A framework-independent core**: the bundled widget does not include Lit. It renders `<wa-*>` custom element tags that a host can swap for its own components at build time.
- **Separated packages**: the agent loop, the framework bindings and each capability live in their own package, communicate by message passing, and read their colours from theme settings you can override.

## Docs Covered Here

1. **[UI Element Seam](#/core/registry)**: Design patterns for framework-independent, customizable rendering seams.
2. **[Architecture](#/guides/architecture)**: End-to-end message flow, tool-call loop, and data-source system.
3. **[Tools & Data Sources](#/core/tools)**: Defining tools and wiring custom data sources.
4. **[Embedding](#/lit/embedding)**: Bubble vs inline panel, programmatic mount.
5. **[Theming](#/guides/theming)**: CSS custom properties, Beer CSS overrides, custom element swaps.
6. **[Interactive Showcase](#/guides/showcase)**: Live interactive Beer CSS UI controls the agent can click, fill, select, and toggle.
7. **[Troubleshooting](#/guides/troubleshooting)**: Common issues and fixes.
8. **[Lit-HTML Host Binding](#/lit/lit-html-binding)**: How to wire the agent embed to lit-html 1.x or 3.x using a build-time alias; the docs-site itself is the worked Lit 1 reference.

Use the sidebar navigation to explore these sections.
