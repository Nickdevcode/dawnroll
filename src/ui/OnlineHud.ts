import * as THREE from 'three';
import { MAX_PLAYERS } from '../net/protocol';
import type { NameplateSource, OnlinePlay } from '../net/OnlinePlay';
import { onLocaleChange, t } from '../i18n';
import { escapeHtml } from './html';
import { Icons } from './icons';

/** Placa de apelido some de longe (vira poluição) e perto demais (tapa o besouro). */
const PLATE_FAR = 46;
const PLATE_NEAR = 1.2;

const tmp = new THREE.Vector3();

/**
 * O online no HUD: o chip da sala (código, quantos na sala, ping e
 * "reconectando") e a placa com o apelido em cima de cada besouro remoto, na
 * cor da vaga dele (a cor nunca vem sozinha: tem o apelido e, no dono, a coroa).
 */
export class OnlineHud {
  private readonly chip: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly shown = new Map<HTMLElement, string>();

  constructor(
    parent: HTMLElement,
    private readonly net: OnlinePlay,
  ) {
    this.chip = document.createElement('div');
    this.chip.className = 'online-chip';
    this.chip.hidden = true;
    this.chip.setAttribute('role', 'status');
    this.layer = document.createElement('div');
    this.layer.className = 'nameplates';
    this.layer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < MAX_PLAYERS - 1; i++) {
      const plate = document.createElement('div');
      plate.className = 'nameplate';
      plate.hidden = true;
      this.layer.append(plate);
      this.plates.push(plate);
    }
    parent.append(this.layer, this.chip);
    net.subscribe(() => this.renderChip());
    onLocaleChange(() => this.renderChip());
    // O ping muda sem aviso: atualiza o chip de tempos em tempos.
    window.setInterval(() => {
      if (this.net.active) this.renderChip();
    }, 2000);
  }

  private renderChip(): void {
    const net = this.net;
    this.chip.hidden = !net.active;
    if (!net.active) {
      for (const plate of this.plates) plate.hidden = true;
      return;
    }
    const status = net.status;
    const reconnecting = status === 'connecting' || status === 'reconnecting';
    const quality = net.isHost ? 'good' : net.ping === 0 ? 'ok' : net.ping < 90 ? 'good' : net.ping < 180 ? 'ok' : 'bad';
    this.chip.dataset.state = reconnecting ? 'reconnecting' : 'online';
    this.chip.innerHTML = /* html */ `
      <span class="online-chip__icon" aria-hidden="true">${Icons.group}</span>
      <span class="online-chip__text">
        <strong>${escapeHtml(t('online.hudRoom', { code: net.code ?? '' }))}</strong>
        <span>${escapeHtml(reconnecting ? t('online.reconnecting') : t('online.playerCount', { n: net.players.length, max: MAX_PLAYERS }))}</span>
      </span>
      ${net.isHost ? `<span class="online-chip__host" title="${escapeHtml(t('online.host'))}">${Icons.crown}</span>` : `<span class="online-chip__ping" data-quality="${quality}">${Icons.signal}<span>${escapeHtml(t('online.ping', { ms: net.ping || '–' }))}</span></span>`}`;
  }

  /** Placas deste quadro (projetadas na tela pela câmera). */
  setNameplates(sources: readonly NameplateSource[], camera: THREE.Camera): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    for (let i = 0; i < this.plates.length; i++) {
      const plate = this.plates[i];
      const source = sources[i];
      if (!source) {
        plate.hidden = true;
        continue;
      }
      const distance = camera.position.distanceTo(source.position);
      tmp.copy(source.position).project(camera);
      const behind = tmp.z > 1 || tmp.z < -1;
      if (behind || distance > PLATE_FAR || distance < PLATE_NEAR || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05) {
        plate.hidden = true;
        continue;
      }
      const key = `${source.slot}|${source.nick}|${source.isHost}`;
      if (this.shown.get(plate) !== key) {
        this.shown.set(plate, key);
        plate.dataset.slot = String(source.slot);
        plate.innerHTML = `${source.isHost ? `<span class="nameplate__crown">${Icons.crown}</span>` : ''}<span class="nameplate__nick">${escapeHtml(source.nick)}</span>`;
      }
      plate.hidden = false;
      const x = (tmp.x * 0.5 + 0.5) * width;
      const y = (-tmp.y * 0.5 + 0.5) * height;
      // Longe fica um pouco menor e mais transparente (profundidade sem poluir).
      const fade = 1 - Math.min(1, Math.max(0, (distance - 18) / (PLATE_FAR - 18)));
      plate.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%) scale(${(0.8 + fade * 0.2).toFixed(3)})`;
      plate.style.opacity = (0.45 + fade * 0.55).toFixed(2);
    }
  }
}
