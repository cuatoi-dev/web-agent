// `pay.test` and `bank.test` are different sites from
// `localhost:10040` AND from each other (different eTLD+1), so Chrome gives
// each its own renderer and its own debugger target. Nothing resolves these
// names: Playwright fulfils the requests itself.
import type { BrowserContext } from "@playwright/test";

const PAY = `<!doctype html><html><head><meta charset="utf-8"><title>Payment</title></head><body>
<h2>Payment</h2>
<label for="card">Card number</label><input id="card" />
<label for="receipt">Receipt</label><input id="receipt" type="file" />
<button id="pay" onclick="document.getElementById('state').textContent='Paid'; console.log('payment frame: pay pressed');">Pay</button>
<p id="state">Unpaid</p>
<iframe id="bank" title="Bank" src="http://bank.test/" width="300" height="90" style="border:0"></iframe>
<script>console.log("payment frame ready");</script>
</body></html>`;

const BANK = `<!doctype html><html><head><meta charset="utf-8"><title>Bank</title></head><body>
<h2>Bank</h2>
<button id="confirm" onclick="document.getElementById('bank-state').textContent='Confirmed'">Confirm with bank</button>
<p id="bank-state">Waiting</p>
</body></html>`;

export const PAY_ORIGIN = "http://pay.test";
export const BANK_ORIGIN = "http://bank.test";

export async function routeCrossSiteFrames(context: BrowserContext): Promise<void> {
  await context.route(`${PAY_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: PAY }),
  );
  await context.route(`${BANK_ORIGIN}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: BANK }),
  );
}
