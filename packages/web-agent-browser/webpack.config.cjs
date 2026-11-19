const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const { generatePublicSansCss } = require("./tool/generate-public-sans-css.cjs");

module.exports = {
  entry: {
    background: "./src/background.ts",
    content: "./src/content.ts",
    bridge: "./src/bridge.ts",
    // The ref tools' page-side half. Emitted as its own bundle so the
    // side panel can read its TEXT and evaluate it inside an isolated world.
    // Never loaded as a script by any page.
    helper: "./src/helper.ts",
    // The recorder's page-side half, in the same shape as `helper`
    // above: its TEXT is evaluated inside an isolated world, in every frame.
    recorder: "./src/recorder.ts",
    options: "./src/options.ts",
    sidepanel: "./src/sidepanel.ts",
  },
  output: {
    // The brand-agnostic half of the extension. tool/build.cjs copies this
    // to dist/ and adds manifest.json, brand.json and icons/.
    path: path.resolve(__dirname, "dist-template"),
    filename: "[name].js",
    publicPath: "",
    clean: true,
  },
  // A service worker cannot import a split chunk, and a content script is
  // loaded as one file. One self-contained bundle per entry.
  optimization: { splitChunks: false, runtimeChunk: false },
  resolve: {
    extensions: [".ts", ".js"],
    extensionAlias: { ".js": [".ts", ".js"] },
  },
  module: {
    parser: { javascript: { dynamicImportMode: "eager" } },
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: {
          loader: "ts-loader",
          options: { transpileOnly: true, configFile: path.resolve(__dirname, "tsconfig.json") },
        },
      },
      { test: /\.js$/, resolve: { fullySpecified: false } },
    ],
  },
  plugins: [
    new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
    new CopyWebpackPlugin({
      patterns: [
        { from: path.resolve(__dirname, "docs/third-party-notices.md"), to: "third-party-notices.md" },
        { from: path.resolve(__dirname, "src/options.html"), to: "options.html" },
        { from: path.resolve(__dirname, "src/sidepanel.html"), to: "sidepanel.html" },
        // The theme tokens the manifest injects with the content_scripts "css"
        // key. Copied unchanged from web-agent-lit; the extension never edits it.
        {
          from: path.resolve(__dirname, "../web-agent-lit/src/themes/wa-tokens.css"),
          to: "wa-tokens.css",
        },
        // Embedded Public Sans stylesheet generated from vendored woff2 fonts.
        // Fails the build if any font file is missing.
        {
          from: path.resolve(__dirname, "vendor/public-sans/VERSION"),
          to: "public-sans.css",
          toType: "file",
          transform() {
            return generatePublicSansCss(path.resolve(__dirname, "vendor/public-sans"));
          },
        },
      ],
    }),
  ],
};
