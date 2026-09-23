/**
 * Peças dos sons contínuos (bola rolando, chuva, vento, zumbidos): fontes que
 * tocam para sempre e só têm o volume/filtro mexido a cada quadro.
 */

/** Ruído em loop eterno, começando num ponto aleatório (camadas iguais não "batem" entre si). */
export function loopNoise(ctx: BaseAudioContext, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const src = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: rate });
  src.start(0, Math.random() * buffer.duration);
  return src;
}

const lastTarget = new WeakMap<AudioParam, number>();

/**
 * Leva um parâmetro até `value` sem degrau audível (`smoothing` ≈ constante de
 * tempo em segundos). Chamado todo quadro: só agenda de novo quando o alvo
 * muda de verdade (>1%), para não entupir a linha do tempo do parâmetro.
 */
export function ease(ctx: BaseAudioContext, param: AudioParam, value: number, smoothing = 0.08): void {
  if (!Number.isFinite(value)) return;
  const last = lastTarget.get(param);
  if (last !== undefined && Math.abs(last - value) <= Math.max(1e-4, Math.abs(last) * 0.01)) return;
  lastTarget.set(param, value);
  param.setTargetAtTime(value, ctx.currentTime, smoothing);
}
