/**
 * Controles das configurações: seletor segmentado (rádio), chave liga/desliga e
 * slider. DOM puro, acessíveis (papéis ARIA, teclado) e com `refresh()` para
 * refazer os rótulos quando o idioma muda.
 */

export interface Control<T> {
  readonly element: HTMLElement;
  set(value: T): void;
  /** Refaz os textos (troca de idioma). */
  refresh(): void;
}

export interface SegmentOption<T extends string> {
  value: T;
  label: () => string;
}

/**
 * Grupo de opções exclusivas (role="radiogroup"). Só a opção marcada entra no
 * Tab; setas, Home e End andam entre elas e já escolhem (padrão WAI-ARIA).
 * `null` desmarca tudo (ex.: qualidade "personalizada").
 */
export function segmented<T extends string>(labelledBy: string, options: SegmentOption<T>[], onChange: (value: T) => void, className = 'segmented'): Control<T | null> {
  const group = document.createElement('div');
  group.className = className;
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-labelledby', labelledBy);
  const buttons = options.map((option) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${className}__option`;
    button.setAttribute('role', 'radio');
    button.dataset.value = option.value;
    button.addEventListener('click', () => onChange(option.value));
    group.append(button);
    return button;
  });
  let current: T | null = null;

  group.addEventListener('keydown', (e) => {
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + buttons.length) % buttons.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = buttons.length - 1;
    else return;
    e.preventDefault();
    buttons[next].focus();
    onChange(options[next].value);
  });

  const control: Control<T | null> = {
    element: group,
    set(value) {
      current = value;
      buttons.forEach((button, i) => {
        const checked = options[i].value === value;
        button.setAttribute('aria-checked', String(checked));
        // Nada marcado: a primeira opção recebe o Tab (senão o grupo fica inalcançável).
        button.tabIndex = checked || (value === null && i === 0) ? 0 : -1;
      });
    },
    refresh() {
      buttons.forEach((button, i) => (button.textContent = options[i].label()));
    },
  };
  control.refresh();
  control.set(current);
  return control;
}

/** Chave liga/desliga (role="switch"). */
export function toggle(labelledBy: string, describedBy: string | null, onChange: (value: boolean) => void): Control<boolean> & { setDisabled(disabled: boolean): void } {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'switch';
  button.setAttribute('role', 'switch');
  button.setAttribute('aria-labelledby', labelledBy);
  if (describedBy) button.setAttribute('aria-describedby', describedBy);
  button.innerHTML = '<span class="switch__knob" aria-hidden="true"></span>';
  let value = false;
  button.addEventListener('click', () => onChange(!value));
  return {
    element: button,
    set(next) {
      value = next;
      button.setAttribute('aria-checked', String(next));
    },
    refresh() {},
    setDisabled(disabled) {
      button.disabled = disabled;
    },
  };
}

export interface SliderOptions {
  min: number;
  max: number;
  step: number;
  /** Texto do valor (ao lado e para o leitor de tela). */
  format: (value: number) => string;
}

/** Slider com o valor escrito ao lado; a parte "cheia" do trilho vem da variável CSS `--fill`. */
export function slider(labelledBy: string, options: SliderOptions, onChange: (value: number) => void): Control<number> {
  const wrap = document.createElement('div');
  wrap.className = 'slider';
  const input = document.createElement('input');
  input.type = 'range';
  input.className = 'slider__input';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.setAttribute('aria-labelledby', labelledBy);
  const output = document.createElement('output');
  output.className = 'slider__value';
  output.setAttribute('aria-hidden', 'true');
  wrap.append(input, output);

  const paint = (value: number) => {
    const fill = ((value - options.min) / (options.max - options.min)) * 100;
    input.style.setProperty('--fill', `${fill}%`);
    const text = options.format(value);
    output.textContent = text;
    input.setAttribute('aria-valuetext', text);
  };
  input.addEventListener('input', () => {
    const value = Number(input.value);
    paint(value);
    onChange(value);
  });

  return {
    element: wrap,
    set(value) {
      input.value = String(value);
      paint(value);
    },
    refresh() {
      paint(Number(input.value));
    },
  };
}
