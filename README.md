# web-agent

A browser-native chat agent that runs inside a web application. It uses tools to observe and act on the page (DOM snapshots, Redux store queries, click, fill, navigate) and replies with rich generative UI (charts, forms, buttons) rendered from model-authored JSON blocks. Built on the Vercel AI SDK with an Anthropic proxy.

See the [design doc](docs/designs/fsd-browser-native-chat-agent.md) for the full specification.

## Scripts

```
pnpm install       # install dependencies
pnpm dev           # start cat-store dev server on :10030
pnpm build         # typecheck + webpack production build
pnpm test          # run vitest
pnpm test:watch    # vitest in watch mode
```
