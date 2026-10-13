const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const TerserPlugin = require("terser-webpack-plugin");

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
    // Token gate (task 001): bakes the real WEB_AGENT_TOKEN into the bundle at
    // build time so docs-embed.ts sends it as X-Web-Agent-Token without
    // hardcoding a literal. Same fallback as the devServer proxy below.
    new webpack.DefinePlugin({
      "process.env.WEB_AGENT_TOKEN": JSON.stringify(process.env.WEB_AGENT_TOKEN || "wa-demo-token"),
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
    // Same method as cat-store: /api/* → the reverse proxy on :28780 (per-provider LLM routes).
    proxy: [{
      context: ["/api"],
      target: "http://localhost:28780",
      changeOrigin: true,
      headers: {
        "X-Web-Agent-Token": process.env.WEB_AGENT_TOKEN || "wa-demo-token",
      },
    }],
  },
};
