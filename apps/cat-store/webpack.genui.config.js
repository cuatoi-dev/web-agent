// Self-contained bundle for the genui frame.
// The frame loads a single <script> — no shared chunks, no separate runtime.
const path = require("path");

module.exports = {
  mode: "production",
  entry: {
    genuiMaterial: "./src/web/genui/genui-material-bundle.ts",
    genuiCapture: "./src/web/genui/genui-capture-bundle.ts",
    genuiChart: "./src/web/genui/genui-chart-bundle.ts",
  },
  output: {
    path: path.resolve(__dirname, "dist", "web"),
    filename: "[name].js",
    // Both configs emit into dist/web, and each numbers its async chunks from
    // its own compilation, so "[id].js" collides: this build's 856.js
    // overwrote the main build's 856.js, which is the chunk holding
    // validateJsonSchemaInput. The main runtime then fetched a file that
    // registered under a different global and reported "Loading chunk 856
    // failed (missing)", disabling tool-argument validation. Namespacing the
    // async chunks keeps the two compilations' outputs apart.
    chunkFilename: "genui-[id].js",
    publicPath: "",
    // Isolates this compilation's chunk-loading global from the main config's.
    // Both builds run from the same package, so without an explicit
    // uniqueName webpack derives the SAME chunkLoadingGlobal for each. Their
    // module registries then merge in the browser, and two modules that were
    // each given deterministic id 3722 by their own compilation — ajv's
    // applicator vocabulary here, a Material-Web Lit component there —
    // overwrite one another. That collision is what made `import("ajv")`
    // throw "(0 , o.default) is not a function" and silently disabled every
    // tool-argument validation in the deployed bundle (docs/tests/0167).
    uniqueName: "cat-store-genui",
  },
  optimization: {
    runtimeChunk: false,
    splitChunks: false,
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
        resolve: { fullySpecified: false },
      },
      {
        test: /\.css$/,
        use: ["style-loader", "css-loader"],
      },
    ],
  },
};
