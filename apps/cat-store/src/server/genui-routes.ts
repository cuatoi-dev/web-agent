import { Router, type Request, type Response } from "express";
import path from "node:path";
import fs from "node:fs";
import { renderGenuiBootstrapScript } from "./genui-bootstrap.js";

export function renderGenuiFrameHtml(profile: "material" | "plain" = "material"): string {
  const isMaterial = profile === "material";
  return `<!DOCTYPE html>
<html lang="en" data-theme="wa2-dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generative UI Frame</title>
  <!-- First script in the document. Everything below it, including the
       resource list, is watched. -->
  <script>${renderGenuiBootstrapScript()}</script>
  <link rel="stylesheet" href="../vendor/public-sans/public-sans.css">
  <link rel="stylesheet" href="wa-tokens.css">
  <!-- Screenshot responder. Loaded in both profiles: the capture channel does
       not depend on Material. -->
  <script src="genui-capture.js"></script>
  ${isMaterial ? '<script src="genui-material.js"></script>' : ""}
  ${isMaterial ? '<script src="genui-chart.js"></script>' : ""}
  <style>
    :root, html, body {
      margin: 0;
      /* Extra left padding keeps content clear of the host's collapse chevron
         which overlaps the left edge of .col-side. */
      padding: var(--wa-padding-l, 12px) var(--wa-padding-l, 12px) var(--wa-padding-l, 12px) 28px;${/* eslint-disable-line wa/no-raw-spacing -- 28px is not on the theme spacing ladder (above the top step --wa-padding-xl 16px, with no higher step); tokenizing would snap the rendered value down to 16px and change the layout. */ ""}
      box-sizing: border-box;
      background: var(--wa-background-color, #f5f5f5);
      color: var(--wa-text-color, #333);
      font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
      overflow-x: auto;
      overflow-y: auto;
    }
    #genui-root {
      width: 100%;
      box-sizing: border-box;
    }
    ${
      isMaterial
        ? `/* genui-material-bundle.ts registers the tags below but sets no colour
           tokens, so they fall back to Material's own light-baseline
           defaults regardless of data-theme. That is what made a pre-filled
           md-outlined-text-field's value text measure 1.06:1 against its own
           field in the wa2-dark theme. Map every colour
           property onto the same --wa-* tokens the host chrome already
           uses (agent-page.ts / acme-registry.ts), so the field flips with
           data-theme exactly like the rest of the panel. Label colours use
           the full-contrast input-text token rather than --wa-label-color:
           the latter measures 4.29:1 against --wa-background-color in
           wa2-light, under the 4.5:1 floor. */
      md-outlined-text-field {
        --md-outlined-text-field-input-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-focus-input-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-hover-input-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-input-text-placeholder-color: var(--wa-input-placeholder-color, var(--wa-label-color));
        --md-outlined-text-field-label-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-hover-label-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-focus-label-text-color: var(--wa-input-text-color, var(--wa-text-color));
        --md-outlined-text-field-outline-color: var(--wa-border-color);
        --md-outlined-text-field-hover-outline-color: var(--wa-outline-color, var(--wa-border-color));
        --md-outlined-text-field-focus-outline-color: var(--wa-outline-color);
        --md-outlined-text-field-caret-color: var(--wa-outline-color);
      }`
        : ""
    }
  </style>
</head>
<body>
  <div id="genui-root"></div>
</body>
</html>`;
}

export function createGenuiRouter(staticDir?: string): Router {
  const router = Router();

  router.get("/frame", (req: Request, res: Response) => {
    const profile = req.query.profile === "plain" ? "plain" : "material";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderGenuiFrameHtml(profile));
  });

  router.get("/wa-tokens.css", (req: Request, res: Response) => {
    const candidates = [
      staticDir ? path.join(staticDir, "genui/wa-tokens.css") : null,
      staticDir ? path.join(staticDir, "wa-tokens.css") : null,
      path.resolve(process.cwd(), "../../packages/web-agent-lit/src/themes/wa-tokens.css"),
      path.resolve(process.cwd(), "packages/web-agent-lit/src/themes/wa-tokens.css"),
    ].filter(Boolean) as string[];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "text/css; charset=utf-8");
        return res.sendFile(file);
      }
    }
    res.status(404).send("wa-tokens.css not found");
  });

  router.get("/genui-material.js", (req: Request, res: Response) => {
    const candidates = [
      staticDir ? path.join(staticDir, "genuiMaterial.js") : null,
      staticDir ? path.join(staticDir, "genui-material.js") : null,
    ].filter(Boolean) as string[];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        return res.sendFile(file);
      }
    }
    res.status(404).send("genui-material.js not found");
  });

  router.get("/genui-capture.js", (req: Request, res: Response) => {
    const candidates = [
      staticDir ? path.join(staticDir, "genuiCapture.js") : null,
      staticDir ? path.join(staticDir, "genui-capture.js") : null,
    ].filter(Boolean) as string[];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        return res.sendFile(file);
      }
    }
    res.status(404).send("genui-capture.js not found");
  });

  router.get("/genui-chart.js", (req: Request, res: Response) => {
    const candidates = [
      staticDir ? path.join(staticDir, "genuiChart.js") : null,
      staticDir ? path.join(staticDir, "genui-chart.js") : null,
    ].filter(Boolean) as string[];

    for (const file of candidates) {
      if (fs.existsSync(file)) {
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        return res.sendFile(file);
      }
    }
    res.status(404).send("genui-chart.js not found");
  });

  return router;
}
