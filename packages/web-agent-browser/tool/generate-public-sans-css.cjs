const fs = require("fs");
const path = require("path");

/**
 * Reads vendored Public Sans woff2 files and returns a CSS string
 * with embedded base64 data URIs.
 * Throws if either font file is missing or empty.
 *
 * @param {string} vendorDir - Directory containing PublicSans-Regular.woff2 and PublicSans-Bold.woff2
 * @returns {string} CSS content with two @font-face rules
 */
function generatePublicSansCss(vendorDir) {
  const regularPath = path.resolve(vendorDir, "PublicSans-Regular.woff2");
  const boldPath = path.resolve(vendorDir, "PublicSans-Bold.woff2");

  if (!fs.existsSync(regularPath)) {
    throw new Error(`Public Sans font file not found: ${regularPath}`);
  }
  if (!fs.existsSync(boldPath)) {
    throw new Error(`Public Sans font file not found: ${boldPath}`);
  }

  const regularBuffer = fs.readFileSync(regularPath);
  const boldBuffer = fs.readFileSync(boldPath);

  if (regularBuffer.length === 0) {
    throw new Error(`Public Sans font file is empty: ${regularPath}`);
  }
  if (boldBuffer.length === 0) {
    throw new Error(`Public Sans font file is empty: ${boldPath}`);
  }

  const regularBase64 = regularBuffer.toString("base64");
  const boldBase64 = boldBuffer.toString("base64");

  return `@font-face {
  font-family: "Public Sans";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("data:font/woff2;base64,${regularBase64}") format("woff2");
}

@font-face {
  font-family: "Public Sans";
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url("data:font/woff2;base64,${boldBase64}") format("woff2");
}
`;
}

module.exports = { generatePublicSansCss };
