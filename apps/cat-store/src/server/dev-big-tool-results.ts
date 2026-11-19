// Development and test fixtures for long-tool-result verification. These are
// registered on the cat-store MCP server only when NODE_ENV is "development" or
// "test", so production never advertises them. They build their strings in
// memory — no network, no disk.

/** 48,210 characters of minified JSON. Order index 50 has note LIVE-PROOF-7731. */
export function bigJsonReport(): string {
  const orders = Array.from({ length: 100 }, (_, i) => ({
    id: "ORD-" + String(i).padStart(3, "0"),
    note: i === 50 ? "LIVE-PROOF-7731" : "",
    detail: "x".repeat(300),
  }));
  const base = { before: "", orders, after: "" };
  const remaining = 48_210 - JSON.stringify(base).length;
  const before = "x".repeat(Math.floor(remaining / 2));
  const after = "x".repeat(remaining - Math.floor(remaining / 2));
  return JSON.stringify({ before, orders, after });
}

/** 48,210 characters of plain text. The line checksum=LIVE-PROOF-4402 sits in
 *  the middle, outside both the first and the last 2,000 characters. */
export function bigTextLog(): string {
  const line = "log ".padEnd(79, "x") + "\n";
  let text = line.repeat(300) + "checksum=LIVE-PROOF-4402\n" + line.repeat(300);
  text += "x".repeat(48_210 - text.length);
  return text;
}
