// Publishing these packages with npm ships a broken manifest.
//
// The workspace packages depend on each other via the `workspace:*` protocol.
// `pnpm publish`/`pnpm pack` rewrite that to the concrete version at pack time;
// `npm publish` does not understand the protocol and ships `workspace:*`
// verbatim, producing a tarball that is uninstallable for every consumer.
//
// Run from `prepublishOnly` so a wrong-client publish fails before upload.

const agent = process.env.npm_config_user_agent ?? "";

if (!/\bpnpm\//.test(agent)) {
  const client = agent.split("/")[0] || "unknown";
  console.error(
    `\nRefusing to publish with "${client}".\n\n` +
      `These packages use the "workspace:*" protocol for their internal\n` +
      `dependencies. Only pnpm rewrites it to a real version at pack time —\n` +
      `npm would publish "workspace:*" as-is and the tarball would be\n` +
      `uninstallable.\n\n` +
      `Use:  pnpm publish -r\n`,
  );
  process.exit(1);
}
