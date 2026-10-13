import type { SkillDef } from "@cuatoi/web-agent-lit";

const definition = `# Stock Monitor — Cat Store Out-of-Stock Watcher

Perform the following steps:
1. Query the products source for id p07 and confirm it is out of stock.
2. Call set_schedule with:
     name: "stock-monitor"
     every: "10m"
     repeat: 5
     prompt: "Check product p07. If inStock is true, call add_to_cart with productId p07 and qty 1, then call cancel_schedule for 'stock-monitor'. If it is still out of stock, say so in one line."
3. Tell the user you will check every 10 minutes, up to 5 times, that you will add the item and stop as soon as it is back, and that the schedule ends if they reload the page or start a new chat.
`;

export const stockMonitorSkill: SkillDef = {
  name: "stock-monitor",
  command: true,
  description:
    "Monitor out-of-stock Crinkle Ball Set every 10 minutes and add to cart when back. Trigger with /stock-monitor.",
  definition,
};
