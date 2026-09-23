/**
 * Abas no padrão WAI-ARIA: clique ou setas trocam e focam a aba; Home/End vão
 * pras pontas. As abas e os painéis já existem no DOM (com `role="tab"` e
 * `role="tabpanel"`); aqui só entra o comportamento. Devolve a função que
 * seleciona uma aba por nome (sem mexer no foco).
 */
export function bindTabs<T extends string>(
  order: readonly T[],
  buttons: ReadonlyMap<T, HTMLButtonElement>,
  panels: ReadonlyMap<T, HTMLElement>,
  onSelect?: (name: T) => void,
): (name: T) => void {
  const select = (name: T) => {
    for (const tab of order) {
      const selected = tab === name;
      const button = buttons.get(tab)!;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      panels.get(tab)!.hidden = !selected;
    }
    onSelect?.(name);
  };

  for (const name of order) {
    const button = buttons.get(name)!;
    button.addEventListener('click', () => select(name));
    button.addEventListener('keydown', (e) => {
      const i = order.indexOf(name);
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % order.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + order.length) % order.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = order.length - 1;
      if (next < 0) return;
      e.preventDefault();
      select(order[next]);
      buttons.get(order[next])!.focus();
    });
  }
  return select;
}

/** Marcação das abas + painéis (o mesmo visual em todas as placas). */
export function tabsMarkup(
  prefix: string,
  labelledBy: string,
  tabs: ReadonlyArray<{ name: string; icon: string; label: string }>,
): { tabs: string; panels: string } {
  return {
    tabs: /* html */ `<div class="tabs" role="tablist" aria-labelledby="${labelledBy}">${tabs
      .map(
        (tab, i) => /* html */ `
        <button class="tabs__tab" type="button" role="tab" id="${prefix}tab-${tab.name}" data-tab="${tab.name}"
          aria-controls="${prefix}panel-${tab.name}" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}">
          ${tab.icon}<span data-t="${tab.label}"></span>
        </button>`,
      )
      .join('')}</div>`,
    panels: tabs
      .map(
        (tab, i) =>
          `<div class="sheet__panel" role="tabpanel" id="${prefix}panel-${tab.name}" aria-labelledby="${prefix}tab-${tab.name}" data-panel="${tab.name}" ${i === 0 ? '' : 'hidden'}></div>`,
      )
      .join(''),
  };
}
