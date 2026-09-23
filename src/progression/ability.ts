/**
 * Poder de apertar (hoje, o Equilibrista): fica ativo por `duration` segundos
 * e depois recarrega por `cooldown` segundos antes de poder usar de novo.
 * Só guarda o relógio; quem decide o que acontece em cada fase é o jogo.
 */
export class Ability {
  /** Em uso agora. */
  active = false;
  private remaining = 0;
  private cooldownLeft = 0;
  private duration = 1;
  private cooldown = 1;

  /** Ajusta tempos (ex.: virou ★★). Não mexe no que já está correndo. */
  configure(duration: number, cooldown: number): void {
    this.duration = Math.max(0.1, duration);
    this.cooldown = Math.max(0.1, cooldown);
  }

  /** Pronto pra usar (não está em uso nem recarregando). */
  get ready(): boolean {
    return !this.active && this.cooldownLeft <= 0;
  }

  /**
   * Carga pro HUD (0..1): em uso, o quanto ainda sobra (esvazia); recarregando,
   * o quanto já voltou (enche); pronto, 1.
   */
  get charge(): number {
    if (this.active) return this.remaining / this.duration;
    if (this.cooldownLeft > 0) return 1 - this.cooldownLeft / this.cooldown;
    return 1;
  }

  /** Segundos que faltam na fase atual (em uso ou recarregando); 0 se pronto. */
  get secondsLeft(): number {
    return this.active ? this.remaining : Math.max(0, this.cooldownLeft);
  }

  /** Começa a usar. Devolve false se ainda não dá. */
  start(): boolean {
    if (!this.ready) return false;
    this.active = true;
    this.remaining = this.duration;
    return true;
  }

  /** Para antes do tempo (ou porque acabou): começa a recarregar. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.remaining = 0;
    this.cooldownLeft = this.cooldown;
  }

  /** Passo do relógio; devolve true no passo em que o tempo de uso acabou. */
  update(dt: number): boolean {
    if (this.active) {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        this.stop();
        return true;
      }
    } else if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - dt);
    }
    return false;
  }

  /** Rodada nova: pronto de novo, sem nada correndo. */
  reset(): void {
    this.active = false;
    this.remaining = 0;
    this.cooldownLeft = 0;
  }
}
