import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import rule from "./no-deep-import.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: "latest", sourceType: "module" },
});

ruleTester.run("no-deep-import", rule, {
  valid: [
    {
      code: 'import { createAgentSession } from "@cuatoi/web-agent-core";',
    },
    {
      code: 'import { chartingRenderers } from "@cuatoi/web-agent-charting/lit";',
    },
    {
      code: 'import "@cuatoi/web-agent-core/package.json";',
    },
    {
      code: 'import { html } from "lit";',
    },
  ],
  invalid: [
    {
      code: 'import { createAgentSession } from "@cuatoi/web-agent-core/src/index.js";',
      errors: [
        {
          messageId: "internalSegment",
          data: {
            spec: "@cuatoi/web-agent-core/src/index.js",
            pkg: "@cuatoi/web-agent-core",
            segment: "src",
          },
        },
      ],
    },
    {
      code: 'import { AgentChatPanel } from "@cuatoi/web-agent-lit/dist/chat-ui/panel.js";',
      errors: [
        {
          messageId: "internalSegment",
          data: {
            spec: "@cuatoi/web-agent-lit/dist/chat-ui/panel.js",
            pkg: "@cuatoi/web-agent-lit",
            segment: "dist",
          },
        },
      ],
    },
    {
      code: 'import { deep } from "@cuatoi/web-agent-core/one/two/three";',
      errors: [
        {
          messageId: "tooDeep",
          data: {
            spec: "@cuatoi/web-agent-core/one/two/three",
            pkg: "@cuatoi/web-agent-core",
            depth: "3",
            max: "2",
          },
        },
      ],
    },
  ],
});
