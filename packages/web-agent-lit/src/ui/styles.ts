export const styles = `

.wa-panel-root {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  min-height: 0;
  max-width: 100%;
}

.wa-composer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--wa-padding-m, 0.5rem);
  padding: var(--wa-padding-l, 0.75rem);
}

.wa-composer input {
  flex: 1 1 12ch;
  min-width: 0;
  min-height: var(--wa-component-size-l, 2.5rem);
}

.wa-composer .wa-actions {
  flex: 0 0 auto;
}

.wa-scroll-region {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.wa-panel-root pre {
  overflow-x: auto;
}

.wa-panel-root * {
  max-width: 100%;
  overflow-wrap: anywhere;
  box-sizing: border-box;
}

@container (max-width: 400px) {
  .wa-composer {
    flex-direction: column;
    align-items: stretch;
  }
  .wa-composer input {
    width: 100%;
  }
}
`;
