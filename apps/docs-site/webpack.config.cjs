const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

// 137/001 — the gateway key: the env value, else the dev default. Used by
// the build define and by the dev-server proxy below.
const GATEWAY_KEY = process.env.WEB_AGENT_TOKEN || "wa-demo-token";

const litSrc   = path.resolve(__dirname, "../../packages/web-agent-lit/src");
const coreSrc  = path.resolve(__dirname, "../../packages/web-agent-core/src");
const litNM    = path.resolve(__dirname, "../../packages/web-agent-lit/node_modules");
const coreNM   = path.resolve(__dirname, "../../packages/web-agent-core/node_modules");
const litHtmlV1 = path.resolve(__dirname, "../../packages/web-agent-lit/node_modules/lit-html-v1");
const appEntry  = path.resolve(__dirname, "src/engine/app.ts");

module.exports = {
  cache: { type: "filesystem", buildDependencies: { config: [__filename] } },
  devtool: "source-map", // preserve the .map files the esbuild build emitted
  entry: {
    "app": ["./src/docs-embed.ts", "./src/engine/app.ts"],
    "gallery": "./src/gallery.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist"), // apps/docs-site/dist (deploy-docs.sh copies dist/.)
    filename: "[name].js",
    publicPath: "",   // relative; <base href> handles the subpath at runtime
    clean: false,     // build-static.mjs already wiped+staged dist/
  },
  // Each bundle is standalone — app (documentation app + agent widget) and gallery (theme showcase).
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
    // extractComments defaults to a separate *.LICENSE.txt per asset; the
    // ground-truth dist/ (esbuild) has none — keep the emitted set identical.
    minimizer: [new TerserPlugin({ extractComments: false })],
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
    // lit/core src use TS NodeNext-style relative imports ("./foo.js" resolving
    // to "./foo.ts"); esbuild did this rewrite natively, webpack needs it explicit.
    extensionAlias: { ".js": [".ts", ".js"] },
    alias: {
      "@cuatoi/web-agent-lit/themes$": path.resolve(litSrc, "themes/registry.ts"),
      "@cuatoi/web-agent-lit": litSrc,
      "@cuatoi/web-agent-core": coreSrc,
    },
    modules: ["node_modules", litNM, coreNM], // resolve lit/core src's own deps
  },
  module: {
    // Webpack's default 'lazy' mode splits each dynamic import() into its own
    // async chunk. 'eager' inlines it into the referencing bundle — no extra
    // numbered chunk files. Added for @anthropic-ai/sdk's guarded import('fs'),
    // a dependency no package here has any more.
    parser: { javascript: { dynamicImportMode: "eager" } },
    rules: [
      // 005: pin `lit-html` to v1 ONLY for the modules that were already written
      // against its v1 API (web-agent-lit's own templates, and docs-site's own
      // app.ts) — scoped by issuer, not global, so it does not also rewrite the
      // `lit` package's (v3) internal `lit-html` import. `docs-agent-widget.ts`
      // imports the real "lit" package, whose LitElement needs lit-html v3
      // (specifically `lit-html/is-server.js`, absent from v1) — a global
      // non-exact alias broke that with "Module not found".
      { issuer: (value) => !!value && (value.startsWith(litSrc) || value === appEntry),
        resolve: { alias: { "lit-html": litHtmlV1 } } },
      { test: /\.ts$/, exclude: /node_modules/, use: { loader: "ts-loader",
        options: { transpileOnly: true, configFile: path.resolve(__dirname, "tsconfig.json") } } },
      { test: /\.js$/, resolve: { fullySpecified: false } },
      { test: /\.css$/, use: ["style-loader", "css-loader"] },
    ],
  },
  plugins: [
    // Key gate (137/001): bakes the gateway key into the bundle at build time
    // so docs-embed.ts sends it in each LLM route's own auth header, without
    // hardcoding a literal in the source.
    new webpack.DefinePlugin({
      "process.env.WEB_AGENT_TOKEN": JSON.stringify(GATEWAY_KEY),
    }),
    new HtmlWebpackPlugin({ template: "./src/engine/index.html", filename: "index.html",
      inject: "body", chunks: ["app"] }),
    new HtmlWebpackPlugin({ template: "./src/gallery.html", filename: "gallery.html",
      inject: "body", chunks: ["gallery"] }),
  ],
  devServer: {
    port: 10031,
    open: false,
    static: { directory: path.resolve(__dirname, "dist"), publicPath: "/public/web-agent-docs" },
    devMiddleware: { publicPath: "/public/web-agent-docs/" },
    historyApiFallback: { index: "/public/web-agent-docs/index.html" },
    // Same method as cat-store: the three LLM routes → the reverse proxy on :30000; any other /api path → :28780.
    // 137/001 — each LLM route gets its own auth header; any other /api
    // path is proxied with no header, as before.
    proxy: [
      { context: ["/api/openai"], target: "http://localhost:30000", changeOrigin: true,
        headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
      { context: ["/api/anthropic"], target: "http://localhost:30000", changeOrigin: true,
        headers: { "x-api-key": GATEWAY_KEY } },
      { context: ["/api/gemini"], target: "http://localhost:30000", changeOrigin: true,
        headers: { "x-goog-api-key": GATEWAY_KEY } },
      { context: ["/api"], target: "http://localhost:28780", changeOrigin: true },
    ],
  },
};
