/**
 * Attaches click and keyboard tablist behavior to an array of tab buttons and their panels.
 *
 * Implements WAI-ARIA Tabs keyboard interaction:
 * - ArrowRight / ArrowLeft navigate with wrap-around and auto-activate.
 * - Home activates the first tab; End activates the last tab.
 * - Tab buttons update aria-selected, tabIndex (0 on active, -1 on inactive).
 * - Corresponding panels toggle their `hidden` property.
 *
 * Initial call selects the first tab.
 */
export function mountTabs(
  tabs: HTMLButtonElement[],
  panels: HTMLElement[],
): { select: (index: number) => void } {
  const n = tabs.length;

  function select(index: number): void {
    for (let j = 0; j < n; j++) {
      const isSelected = j === index;
      tabs[j].setAttribute("aria-selected", isSelected ? "true" : "false");
      tabs[j].tabIndex = isSelected ? 0 : -1;
      panels[j].hidden = !isSelected;
    }
  }

  for (let i = 0; i < n; i++) {
    tabs[i].addEventListener("click", () => select(i));
    tabs[i].addEventListener("keydown", (e: KeyboardEvent) => {
      let targetIndex = -1;
      if (e.key === "ArrowRight") {
        targetIndex = (i + 1) % n;
      } else if (e.key === "ArrowLeft") {
        targetIndex = (i - 1 + n) % n;
      } else if (e.key === "Home") {
        targetIndex = 0;
      } else if (e.key === "End") {
        targetIndex = n - 1;
      }
      if (targetIndex !== -1) {
        e.preventDefault();
        select(targetIndex);
        tabs[targetIndex].focus();
      }
    });
  }

  select(0);
  return { select };
}
