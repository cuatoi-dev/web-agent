// 124/003 — an external script, so a reload of checkout.html logs a `script`
// request in page_network. It changes nothing on the page.
document.documentElement.dataset.checkoutExtra = "loaded";
