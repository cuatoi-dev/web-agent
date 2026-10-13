import { describe, it, expect } from "vitest";
import {
  checkEntry,
  clickEntry,
  createActionJournal,
  dialogEntry,
  emulateEntry,
  emulateResetEntry,
  fillEntry,
  frameRoot,
  hoverEntry,
  journalSuffix,
  notJournaledSuffix,
  pressKeyEntry,
  quote,
  readJournalTarget,
  recordedStepEntry,
  selectEntry,
  uploadEntry,
} from "./action-journal";
import type { JournalTarget } from "./action-journal.types";
import type { RecordedStep } from "./recorder.types";

const APPLY: JournalTarget = {
  role: "button",
  name: "Apply",
  label: 'button "Apply"',
  locator: "getByRole('button', { name: 'Apply' })",
  isPassword: false,
};

describe("action-journal", () => {
  it("1. createActionJournal appends and assigns sequential ids", () => {
    const journal = createActionJournal();
    const a = clickEntry(APPLY, APPLY.locator!);
    const b = clickEntry(APPLY, APPLY.locator!);
    expect(journal.append([a, b])).toEqual([1, 2]);
    const c = clickEntry(APPLY, APPLY.locator!);
    expect(journal.append([c])).toEqual([3]);
    expect(journal.entries().map((e) => e.id)).toEqual([1, 2, 3]);
  });

  it("2. a session id change empties the journal", () => {
    let sid = "s1";
    const journal = createActionJournal(() => sid);
    journal.append([clickEntry(APPLY, APPLY.locator!)]);
    sid = "s2";
    expect(journal.entries()).toEqual([]);
    expect(journal.append([clickEntry(APPLY, APPLY.locator!)])).toEqual([1]);
  });

  it("3. quote escapes backslash, quote, CR and LF", () => {
    expect(quote("it's \\ a\nb")).toBe("'it\\'s \\\\ a\\nb'");
  });

  it("4. journalSuffix and notJournaledSuffix", () => {
    expect(journalSuffix([])).toBe("");
    expect(journalSuffix([3])).toBe(" (journal #3)");
    expect(journalSuffix([3, 4, 5])).toBe(" (journal #3–#5)");
    expect(notJournaledSuffix('[5] generic ""')).toBe(' (not journaled: no stable locator for [5] generic "")');
  });

  it("5. readJournalTarget reads defensively", () => {
    expect(readJournalTarget(undefined)).toEqual({ role: "", name: "", label: "", isPassword: false });
    expect(readJournalTarget(APPLY)).toEqual(APPLY);
  });

  it("6. fillEntry: password value never enters the entry", () => {
    const passwordTarget: JournalTarget = {
      role: "textbox",
      name: "Password",
      label: 'textbox "Password"',
      locator: "getByLabel('Password')",
      isPassword: true,
    };
    const entry = fillEntry(passwordTarget, "getByLabel('Password')", "secret123");
    expect(entry).toEqual({
      kind: "action",
      text: 'fill textbox "Password" <password>',
      code: ["await page.getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');"],
      password: true,
    });
    expect(JSON.stringify(entry)).not.toContain("secret123");

    const couponTarget: JournalTarget = {
      role: "textbox",
      name: "Coupon",
      label: 'textbox "Coupon"',
      locator: "getByLabel('Coupon')",
      isPassword: false,
    };
    const fill = fillEntry(couponTarget, "getByLabel('Coupon')", "SAVE10");
    expect(fill.text).toBe('fill textbox "Coupon" "SAVE10"');
    expect(fill.code).toEqual(["await page.getByLabel('Coupon').fill('SAVE10');"]);
  });

  it("7. clickEntry and selectEntry", () => {
    const click = clickEntry(APPLY, APPLY.locator!);
    expect(click.text).toBe('click button "Apply"');
    expect(click.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).click();"]);

    const extras: JournalTarget = {
      role: "combobox",
      name: "Extras",
      label: 'combobox "Extras"',
      locator: "getByLabel('Extras')",
      isPassword: false,
    };
    const one = selectEntry(extras, "getByLabel('Extras')", ["A"]);
    expect(one.code[0].endsWith(".selectOption('A');")).toBe(true);
    expect(one.text).toBe('select combobox "Extras" "A"');
    const two = selectEntry(extras, "getByLabel('Extras')", ["A", "B"]);
    expect(two.code[0].endsWith(".selectOption(['A', 'B']);")).toBe(true);
    expect(two.text.endsWith('"A", "B"')).toBe(true);
  });

  it("8. hoverEntry and pressKeyEntry", () => {
    const cart: JournalTarget = {
      role: "link",
      name: "Cart (2)",
      label: 'link "Cart (2)"',
      locator: "getByRole('link', { name: 'Cart (2)' })",
      isPassword: false,
    };
    const hover = hoverEntry(cart, cart.locator!);
    expect(hover.code[0].endsWith(".hover();")).toBe(true);
    expect(hover.text).toBe('hover link "Cart (2)"');

    const press = pressKeyEntry("Control+Enter");
    expect(press.text).toBe("press Control+Enter");
    expect(press.code).toEqual(["await page.keyboard.press('Control+Enter');"]);
  });

  it("9. uploadEntry: text, base64, size/fill, and file(s) plural", () => {
    const attachments: JournalTarget = {
      role: "button",
      name: "Attachments",
      label: 'button "Attachments"',
      locator: "getByLabel('Attachments')",
      isPassword: false,
    };
    const big = uploadEntry(attachments, "getByLabel('Attachments')", [
      { name: "big.bin", mimeType: "application/octet-stream", size: 5242880, fill: "A" },
    ]);
    expect(big.code).toEqual([
      "await page.getByLabel('Attachments').setInputFiles([",
      "  { name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(5242880, 'A') },",
      "]);",
    ]);
    expect(big.text).toBe('upload 1 file to button "Attachments"');

    const text = uploadEntry(attachments, "getByLabel('Attachments')", [
      { name: "a.csv", mimeType: "text/csv", text: "a,b" },
    ]);
    expect(text.code[1]).toContain("Buffer.from('a,b')");

    const base64 = uploadEntry(attachments, "getByLabel('Attachments')", [
      { name: "a.bin", mimeType: "application/octet-stream", base64: "QQ==" },
    ]);
    expect(base64.code[1]).toContain("Buffer.from('QQ==', 'base64')");

    const twoFiles = uploadEntry(attachments, "getByLabel('Attachments')", [
      { name: "a.csv", mimeType: "text/csv", text: "a" },
      { name: "b.csv", mimeType: "text/csv", text: "b" },
    ]);
    expect(twoFiles.text.startsWith("upload 2 files to")).toBe(true);
  });

  it("10. dialogEntry: dismiss, accept with prompt, accept without prompt", () => {
    expect(dialogEntry(false, "x").code).toEqual(["page.once('dialog', dialog => dialog.dismiss());"]);
    expect(dialogEntry(false, "x").text).toBe("answer the next dialog: dismiss");
    expect(dialogEntry(true, "hi").code).toEqual(["page.once('dialog', dialog => dialog.accept('hi'));"]);
    expect(dialogEntry(true, undefined).code).toEqual(["page.once('dialog', dialog => dialog.accept());"]);
  });

  it("11. emulateEntry and emulateResetEntry", () => {
    const preset = emulateEntry({ preset: "iPhone 15", width: 393, height: 659, scale: 3, mobile: true, touch: true });
    expect(preset).toEqual({
      kind: "emulate",
      text: "emulate iPhone 15",
      code: [],
      password: false,
      emulation: { preset: "iPhone 15", width: 393, height: 659, scale: 3, mobile: true, touch: true },
    });
    const custom = emulateEntry({ width: 800, height: 600, scale: 1, mobile: false, touch: false });
    expect(custom.text).toBe("emulate 800 × 600");
    expect(emulateResetEntry()).toEqual({ kind: "emulate-reset", text: "emulate reset", code: [], password: false });
  });

  it("12. checkEntry for each kind, and undefined when no locator", () => {
    const textVisible = checkEntry({ kind: "text_visible", text: "Discount: -$4.20" }, undefined);
    expect(textVisible).toEqual({
      kind: "check",
      text: 'verify text "Discount: -$4.20"',
      code: ["await expect(page.getByText('Discount: -$4.20')).toBeVisible();"],
      password: false,
    });

    const elementVisible = checkEntry({ kind: "element_visible" }, APPLY);
    expect(elementVisible?.text).toBe('verify button "Apply" visible');
    expect(elementVisible?.code).toEqual(["await expect(page.getByRole('button', { name: 'Apply' })).toBeVisible();"]);

    const coupon: JournalTarget = {
      role: "textbox",
      name: "Coupon",
      label: 'textbox "Coupon"',
      locator: "getByLabel('Coupon')",
      isPassword: false,
    };
    const value = checkEntry({ kind: "value", value: "SAVE10" }, coupon);
    expect(value?.text).toBe('verify textbox "Coupon" value "SAVE10"');
    expect(value?.code[0].endsWith(".toHaveValue('SAVE10');")).toBe(true);

    const orderSummary: JournalTarget = {
      role: "list",
      name: "Order summary",
      label: 'list "Order summary"',
      locator: "getByRole('list', { name: 'Order summary' })",
      isPassword: false,
    };
    const list = checkEntry({ kind: "list", items: ["Coupon", "Total"] }, orderSummary);
    expect(list?.text).toBe('verify list "Order summary" "Coupon", "Total"');
    expect(list?.code).toEqual([
      "await expect(page.getByRole('list', { name: 'Order summary' }).getByText('Coupon')).toBeVisible();",
      "await expect(page.getByRole('list', { name: 'Order summary' }).getByText('Total')).toBeVisible();",
    ]);

    const noLocator: JournalTarget = { role: "button", name: "Apply", label: 'button "Apply"', isPassword: false };
    expect(checkEntry({ kind: "element_visible" }, noLocator)).toBeUndefined();
  });

  describe("131/003 — frameRoot and frameLocator entries", () => {
    it("frameRoot builds a nested frameLocator expression", () => {
      expect(frameRoot([])).toBe("page");
      expect(frameRoot(["iframe#a", "iframe#b"])).toBe("page.frameLocator('iframe#a').frameLocator('iframe#b')");
    });

    it("writes a click inside a frame through frameLocator", () => {
      const entry = clickEntry(APPLY, APPLY.locator!, ["iframe#payment"]);
      expect(entry.code).toEqual([
        "await page.frameLocator('iframe#payment').getByRole('button', { name: 'Apply' }).click();",
      ]);
      expect(entry.frames).toEqual(["iframe#payment"]);
    });

    it("keeps a top-frame entry unchanged", () => {
      const entry = clickEntry(APPLY, APPLY.locator!);
      expect(entry.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).click();"]);
      expect(entry.frames).toBeUndefined();
    });

    it("fillEntry writes a frameLocator prefix, for the password and the plain branch", () => {
      const passwordTarget: JournalTarget = {
        role: "textbox",
        name: "Password",
        label: 'textbox "Password"',
        locator: "getByLabel('Password')",
        isPassword: true,
      };
      const masked = fillEntry(passwordTarget, "getByLabel('Password')", "secret", ["iframe#payment"]);
      expect(masked.code).toEqual([
        "await page.frameLocator('iframe#payment').getByLabel('Password').fill(process.env.TEST_PASSWORD ?? '');",
      ]);
      expect(masked.frames).toEqual(["iframe#payment"]);

      const plain = fillEntry(
        { role: "textbox", name: "Card number", label: 'textbox "Card number"', locator: "getByLabel('Card number')", isPassword: false },
        "getByLabel('Card number')",
        "4242 4242 4242 4242",
        ["iframe#payment"],
      );
      expect(plain.code).toEqual([
        "await page.frameLocator('iframe#payment').getByLabel('Card number').fill('4242 4242 4242 4242');",
      ]);
    });

    it("selectEntry writes a frameLocator prefix", () => {
      const speed: JournalTarget = { role: "combobox", name: "Speed", label: 'combobox "Speed"', locator: "getByLabel('Speed')", isPassword: false };
      const entry = selectEntry(speed, "getByLabel('Speed')", ["exp"], ["iframe#shipping"]);
      expect(entry.code).toEqual(["await page.frameLocator('iframe#shipping').getByLabel('Speed').selectOption('exp');"]);
      expect(entry.frames).toEqual(["iframe#shipping"]);
    });

    it("hoverEntry writes a frameLocator prefix", () => {
      const entry = hoverEntry(APPLY, APPLY.locator!, ["iframe#payment"]);
      expect(entry.code).toEqual(["await page.frameLocator('iframe#payment').getByRole('button', { name: 'Apply' }).hover();"]);
      expect(entry.frames).toEqual(["iframe#payment"]);
    });

    it("uploadEntry writes a frameLocator prefix", () => {
      const receipt: JournalTarget = { role: "button", name: "Receipt", label: 'button "Receipt"', locator: "getByLabel('Receipt')", isPassword: false };
      const entry = uploadEntry(receipt, "getByLabel('Receipt')", [{ name: "r.txt", mimeType: "text/plain", text: "hi" }], ["iframe#payment"]);
      expect(entry.code[0]).toBe("await page.frameLocator('iframe#payment').getByLabel('Receipt').setInputFiles([");
      expect(entry.frames).toEqual(["iframe#payment"]);
    });

    it("checkEntry writes a frameLocator prefix for element_visible", () => {
      const entry = checkEntry({ kind: "element_visible" }, APPLY, ["iframe#payment"]);
      expect(entry?.code).toEqual([
        "await expect(page.frameLocator('iframe#payment').getByRole('button', { name: 'Apply' })).toBeVisible();",
      ]);
      expect(entry?.frames).toEqual(["iframe#payment"]);
    });

    it("leaves text_visible on page", () => {
      const entry = checkEntry({ kind: "text_visible", text: "Paid" }, undefined, ["iframe#payment"]);
      expect(entry?.code).toEqual(["await expect(page.getByText('Paid')).toBeVisible();"]);
      expect(entry?.frames).toBeUndefined();
    });
  });

  describe("recordedStepEntry (124/005)", () => {
    const target = (over: Partial<JournalTarget> = {}): JournalTarget => ({
      role: "button",
      name: "Apply",
      label: '[3] button "Apply"',
      locator: "getByRole('button', { name: 'Apply' })",
      isPassword: false,
      ...over,
    });
    const step = (over: Partial<RecordedStep>): RecordedStep => ({
      recordingId: "r1",
      seq: 0,
      kind: "click",
      line: 'click button "Apply"',
      target: target(),
      ...over,
    });

    it("R1 click", () => {
      expect(recordedStepEntry(step({}))).toEqual({
        kind: "action",
        text: 'click button "Apply"',
        code: ["await page.getByRole('button', { name: 'Apply' }).click();"],
        password: false,
      });
    });

    it("R2 hover", () => {
      const s = step({ kind: "hover", line: 'hover link "Cart (2)"' });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).hover();"]);
      expect(entry?.text).toBe(s.line);
    });

    it("R3 fill", () => {
      const s = step({ kind: "fill", value: "SAVE10", line: 'fill textbox "Coupon" "SAVE10"' });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).fill('SAVE10');"]);
      expect(entry?.password).toBe(false);
    });

    it("R4 masked fill", () => {
      const s = step({ kind: "fill", masked: true, line: 'fill textbox "Password" <password>' });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).fill(process.env.TEST_PASSWORD ?? '');"]);
      expect(entry?.password).toBe(true);
      expect(JSON.stringify(entry)).not.toContain("secret123");
      expect(JSON.stringify(entry)).not.toContain("value");
    });

    it("R5 select one", () => {
      const s = step({ kind: "select", values: ["Express"] });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).selectOption('Express');"]);
    });

    it("R6 select many", () => {
      const s = step({ kind: "select", values: ["Gift wrap", "Card"] });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).selectOption(['Gift wrap', 'Card']);"]);
    });

    it("R7 check", () => {
      const s = step({ kind: "check" });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).check();"]);
    });

    it("R8 uncheck", () => {
      const s = step({ kind: "uncheck" });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).uncheck();"]);
    });

    it("R9 press with a target", () => {
      const s = step({ kind: "press", key: "Enter", line: "press Enter" });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.getByRole('button', { name: 'Apply' }).press('Enter');"]);
    });

    it("R10 press with no target", () => {
      const s = step({ kind: "press", key: "Enter", line: "press Enter", target: undefined });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.keyboard.press('Enter');"]);
    });

    it("R11 scroll", () => {
      const s = step({ kind: "scroll", deltaY: 400, line: "scroll down 400 px", target: undefined });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.mouse.wheel(0, 400);"]);
    });

    it("R12 scroll rounds a fractional delta", () => {
      const s = step({ kind: "scroll", deltaY: 399.6, line: "scroll down 400 px", target: undefined });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.mouse.wheel(0, 400);"]);
    });

    it("R13 route", () => {
      const s = step({ kind: "route", path: "/cart", line: "route to /cart", target: undefined });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.waitForURL('**/cart');"]);
    });

    it("R14 no locator", () => {
      const s = step({ target: target({ locator: undefined }) });
      expect(recordedStepEntry(s)).toBeUndefined();
    });

    it("R15 escaping", () => {
      const s = step({ kind: "fill", value: "it's \"quoted\"", line: 'fill textbox "Test" "it\'s \\"quoted\\""' });
      const entry = recordedStepEntry(s);
      expect(entry?.code[0]).toContain("'it\\'s \"quoted\"'");
    });

    it("R16 click inside a frame (131/004)", () => {
      const s = step({ frames: ["#payment"], line: 'click button "Pay"' });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.frameLocator('#payment').getByRole('button', { name: 'Apply' }).click();"]);
      expect(entry?.frames).toEqual(["#payment"]);
    });

    it("R17 the same step with no frames is unchanged from today", () => {
      const entry = recordedStepEntry(step({}));
      expect(entry?.code[0].startsWith("await page.getByRole(")).toBe(true);
      expect(entry?.frames).toBeUndefined();
    });

    it("R18 a masked fill inside a frame", () => {
      const s = step({ kind: "fill", masked: true, frames: ["#payment"], line: 'fill textbox "Card" <password>' });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.frameLocator('#payment').getByRole('button', { name: 'Apply' }).fill(process.env.TEST_PASSWORD ?? '');"]);
      expect(entry?.password).toBe(true);
    });

    it("R19 a scroll step with frames does not apply them", () => {
      const s = step({ kind: "scroll", deltaY: 400, line: "scroll down 400 px", target: undefined, frames: ["#payment"] });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.mouse.wheel(0, 400);"]);
    });

    it("R20 a route step with frames does not apply them", () => {
      const s = step({ kind: "route", path: "/cart", line: "route to /cart", target: undefined, frames: ["#payment"] });
      const entry = recordedStepEntry(s);
      expect(entry?.code).toEqual(["await page.waitForURL('**/cart');"]);
    });
  });
});
