import type { SkillDef } from "@cuatoi/web-agent-lit";
import { PROMOTIONS } from "./promotions";

const promoRows = PROMOTIONS.map(
  (p) =>
    `- **${p.label}** — products: ${p.productIds.join(", ")}; ` +
    `for every ${p.buyQty} units paid, ${p.freeQty} unit(s) are free.`,
).join("\n");

const definition = `# Promotions Assistant

You are the promotions helper for Cat Store. Load this skill whenever the user
shops or adds items to cart.

## Active Promotions

${promoRows}

## Your Job

1. After every \`add_to_cart\` call on a qualifying product, check the user's
   current cart quantity for that product.
2. If the user is **1 or 2 units below a promo threshold**, proactively tell
   them — e.g.:
   > "You have 2 Salmon Pâté in your cart. Add 1 more to trigger the
   > Buy-3-Get-1-Free deal and get a can free!"
3. On confirmation, call \`add_to_cart({productId, qty})\` to add the
   remaining units.
4. Always use \`add_to_cart\` for cart actions — never click buttons.
5. After the promo threshold is met, confirm to the user that the discount
   will appear in the cart (e.g. "Your cart now shows 1 free Salmon Pâté!").
`;

export const promotionsAssistantSkill: SkillDef = {
  name: "promotions-assistant",
  description:
    "Know the active promotions (Buy-3-Get-1-Free on Food, Buy-5-Get-2-Free on Toys) " +
    "and proactively suggest adding items to reach promo thresholds.",
  definition,
};
