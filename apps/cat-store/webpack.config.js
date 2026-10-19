const path = require("path");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");

// 137/001 — the gateway key: the env value, else the dev default. Used by
// the build define and by the dev-server proxy below.
const GATEWAY_KEY = process.env.WEB_AGENT_TOKEN || "wa-demo-token";

module.exports = {
  cache: {
    type: "filesystem",
    buildDependencies: { config: [__filename] },
  },
  entry: {
    main: "./src/web/index.ts",
    gallery: "./src/web/dev/gallery.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist", "web"),
    filename: "[name].js",
    // Relative asset paths so the build works when served under a subpath
    // (deployed at /cat-store/ behind a reverse proxy that strips the prefix).
    publicPath: "",
    clean: true,
    // Paired with webpack.genui.config.js's uniqueName — see the note there.
    // Both compilations ship into the same page, so each needs its own
    // chunk-loading global or their module ids collide.
    uniqueName: "cat-store-app",
  },
  optimization: {
    runtimeChunk: 'single',
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  resolve: {
    extensions: [".ts", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: {
            transpileOnly: true,
            configFile: path.resolve(__dirname, "tsconfig.json"),
          },
        },
      },
      {
        test: /\.js$/,
        resolve: {
          fullySpecified: false,
        },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
  plugins: [
    // Key gate (137/001): bakes the gateway key into the bundle at build time
    // so gateway-auth.ts sends it in each LLM route's own auth header,
    // without hardcoding a literal in the source.
    new webpack.DefinePlugin({
      "process.env.WEB_AGENT_TOKEN": JSON.stringify(GATEWAY_KEY),
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, "vendor/public-sans"),
          to: "vendor/public-sans",
        },
        {
          from: path.resolve(__dirname, "../../packages/web-agent-lit/src/themes/wa-tokens.css"),
          to: "genui/wa-tokens.css",
          noErrorOnMissing: true,
        },
        // The browser asks for /favicon.ico at the site root on its own, so one
        // file at the output root serves index.html and gallery.html when the
        // app is served from a root (the webpack dev server on :10030).
        {
          from: path.resolve(__dirname, "src/web/favicon.ico"),
          to: "favicon.ico",
        },
      ],
    }),
    new webpack.NormalModuleReplacementPlugin(
      /[\\/]ui[\\/]registry\.js$/,
      path.resolve(__dirname, "src/acme-registry.ts")
    ),
    new HtmlWebpackPlugin({
      template: "./src/web/index.html",
      chunks: ["runtime", "vendors", "main"],
      filename: "index.html",
    }),
    new HtmlWebpackPlugin({
      template: "./src/web/dev/gallery.html",
      chunks: ["runtime", "vendors", "gallery"],
      filename: "gallery.html",
    }),
  ],
  devServer: {
    static: path.resolve(__dirname, "dist"),
    port: 10030,
    open: false,
    // /api/orders, /api/es-orders, /mcp and /genui go to the local Express
    // server; the LLM proxy paths keep hitting the reverse proxy on :28780
    // (serves the demo + proxies the LLM providers with injected auth).
    proxy: [
      {
        context: ["/api/orders", "/api/es-orders", "/mcp", "/genui"],
        target: "http://localhost:20030",
        changeOrigin: true,
      },
      // 137/001 — one entry per LLM route, each sending that route's own
      // auth header.
      {
        context: ["/api/openai"],
        target: "http://localhost:28780",
        changeOrigin: true,
        headers: { Authorization: `Bearer ${GATEWAY_KEY}` },
      },
      {
        context: ["/api/anthropic"],
        target: "http://localhost:28780",
        changeOrigin: true,
        headers: { "x-api-key": GATEWAY_KEY },
      },
      {
        context: ["/api/gemini"],
        target: "http://localhost:28780",
        changeOrigin: true,
        headers: { "x-goog-api-key": GATEWAY_KEY },
      },
    ],
  },
};
