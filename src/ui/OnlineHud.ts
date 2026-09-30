import * as THREE from 'three';
import { MAX_PLAYERS } from '../net/protocol';
import type { NameplateSource, OnlinePlay } from '../net/OnlinePlay';
import type { Input } from '../core/Input';
import { onLocaleChange, t, type MessageKey } from '../i18n';
import { clanTagHtml } from './clanText';
import { escapeHtml } from './html';
import { Icons } from './icons';
import { EMOTE_ICONS, EmoteButtonIcon, MergeIcon, PullIcon } from './emoteIcons';
import { EmoteWheel } from './EmoteWheel';
import { MatchHud } from './MatchHud';
import { TEAM_ICONS } from './matchIcons';
import { placeMarker, type ScreenMargins } from './screenMarker';

/** Placa de apelido some de longe (vira poluição) e perto demais (tapa o besouro). */
const PLATE_FAR = 46;
const PLATE_NEAR = 1.2;
/** Balão de reação (e o próprio) aparece mais longe que a placa: é pra ser visto. */
const BUBBLE_FAR = 70;
/** Folga (px) entre duas placas empilhadas. */
const PLATE_GAP = 3;
/** Botão de fundir/puxar do toque: fica na tela mais isso depois que o encosto acaba (ms). */
const HOLD_BUTTON_LINGER_MS = 400;

/** Botão de segurar do toque (fundir, puxar): o botão, como largar e até quando fica na tela. */
interface HoldButton {
  button: HTMLButtonElement;
  release: () => void;
  hideAt: number;
}

/** Liga um botão de segurar: apertou = ativo; soltou, cancelou ou o dedo saiu = larga. */
function holdButton(button: HTMLButtonElement, set: (active: boolean) => void): HoldButton {
  const toggle = (active: boolean) => {
    button.classList.toggle('is-active', active);
    set(active);
  };
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggle(true);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) button.addEventListener(type, () => toggle(false));
  return { button, release: () => toggle(false), hideAt: 0 };
}

const tmp = new THREE.Vector3();

/** Uma placa na tela neste quadro: base no meio embaixo em (x, y), tamanho sem escala (w, h). */
interface PlacedPlate {
  plate: HTMLElement;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  opacity: number;
  distance: number;
}

/**
 * Placas encavaladas (besouros lado a lado: o pódio, o time andando junto): a
 * do besouro mais perto fica; cada outra que cobre uma já posta sobe até ficar
 * logo acima dela. Muda `y` no lugar.
 */
export function spreadPlates(placed: PlacedPlate[]): void {
  placed.sort((a, b) => a.distance - b.distance);
  for (let i = 1; i < placed.length; i++) {
    const e = placed[i];
    const halfW = (e.w * e.scale) / 2;
    // Cada subida pode encostar em outra já posta: repete até ficar livre (no máximo uma vez por placa).
    for (let pass = 0; pass < i; pass++) {
      let moved = false;
      for (let j = 0; j < i; j++) {
        const o = placed[j];
        const apart = Math.abs(e.x - o.x) >= halfW + (o.w * o.scale) / 2 + PLATE_GAP;
        if (apart || e.y - e.h >= o.y || e.y <= o.y - o.h) continue;
        e.y = o.y - o.h - PLATE_GAP;
        moved = true;
      }
      if (!moved) break;
    }
  }
}

/**
 * O online no HUD: o chip da sala (código, quantos na sala, ping e
 * "reconectando"), a placa com o apelido em cima de cada besouro remoto (na
 * cor da vaga dele: a cor nunca vem sozinha, tem o apelido e, no dono, a
 * coroa), o balão das reações, o marcador "Aqui!" no chão, a roda de reações
 * e, no toque, os botões de reagir, de fundir e de puxar.
 */
export class OnlineHud {
  private readonly chip: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly shown = new Map<HTMLElement, string>();
  /** Tamanho de cada placa (medido só quando o conteúdo muda). */
  private readonly sizes = new Map<HTMLElement, { w: number; h: number }>();
  private readonly placed: PlacedPlate[] = [];
  private readonly pingLayer: HTMLElement;
  private readonly pingEls: HTMLElement[] = [];
  readonly wheel: EmoteWheel;
  /** Disputa: relógio, placar, contagem e o cartão do resultado. */
  readonly match: MatchHud;
  private readonly touchBar: HTMLElement | null = null;
  /** Toque: segurar pra fundir / pra puxar (cada um aparece só quando dá). Soltar o botão (ou ele sumir) larga. */
  private readonly holdButtons: HoldButton[] = [];

  constructor(
    parent: HTMLElement,
    private readonly net: OnlinePlay,
    input: Input,
    isTouch: boolean,
  ) {
    this.chip = document.createElement('div');
    this.chip.className = 'online-chip';
    this.chip.hidden = true;
    this.chip.setAttribute('role', 'status');
    this.layer = document.createElement('div');
    this.layer.className = 'nameplates';
    this.layer.setAttribute('aria-hidden', 'true');
    // Uma placa por remoto + o balão do seu próprio besouro.
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const plate = document.createElement('div');
      plate.className = 'nameplate';
      plate.hidden = true;
      this.layer.append(plate);
      this.plates.push(plate);
    }
    this.pingLayer = document.createElement('div');
    this.pingLayer.className = 'ping-layer';
    this.pingLayer.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const ping = document.createElement('div');
      ping.className = 'ping-marker';
      ping.hidden = true;
      ping.innerHTML = `<span class="ping-marker__pin">${EMOTE_ICONS[7]}</span><span class="ping-marker__arrow">${Icons.pointer}</span>`;
      this.pingLayer.append(ping);
      this.pingEls.push(ping);
    }
    this.wheel = new EmoteWheel(parent, isTouch);
    this.wheel.onSend = (index) => this.net.sendEmote(index);
    parent.append(this.pingLayer, this.layer, this.chip);
    this.match = new MatchHud(parent, net);

    if (isTouch) {
      // Toque: reagir (abre a roda), puxar e fundir (aparecem só encostando noutra bola; segurar).
      const bar = document.createElement('div');
      bar.className = 'online-touch';
      bar.hidden = true;
      bar.innerHTML = /* html */ `
        <button class="btn touch-btn online-touch__pull" type="button" data-touch-pull hidden>${PullIcon}</button>
        <button class="btn touch-btn online-touch__merge" type="button" data-touch-merge hidden>${MergeIcon}</button>
        <button class="btn touch-btn online-touch__emote" type="button" data-touch-emote>${EmoteButtonIcon}</button>`;
      const emote = bar.querySelector('[data-touch-emote]') as HTMLButtonElement;
      emote.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        input.queueEmote();
      });
      this.holdButtons.push(
        holdButton(bar.querySelector('[data-touch-merge]') as HTMLButtonElement, (active) => input.setTouchMerge(active)),
        holdButton(bar.querySelector('[data-touch-pull]') as HTMLButtonElement, (active) => input.setTouchPull(active)),
      );
      parent.append(bar);
      this.touchBar = bar;
    }

    net.subscribe(() => this.renderChip());
    onLocaleChange(() => {
      this.renderChip();
      this.shown.clear();
      this.renderTouchLabels();
    });
    // A fonte do apelido chegou depois da primeira medida: mede as placas de novo.
    document.fonts?.addEventListener('loadingdone', () => this.sizes.clear());
    this.renderTouchLabels();
    // O ping muda sem aviso: atualiza o chip de tempos em tempos.
    window.setInterval(() => {
      if (this.net.active) this.renderChip();
    }, 2000);
  }

  /**
   * Dá pra fundir / puxar agora (encostando noutra bola): os botões do toque
   * aparecem. Somem um instante depois de não dar mais (o quique das bolas na
   * beira do encosto não faz o botão piscar debaixo do dedo).
   */
  setMergeAvailable(give: boolean, pull: boolean): void {
    const [merge, pullButton] = this.holdButtons;
    if (!merge || !pullButton) return;
    const now = performance.now();
    for (const [entry, available] of [
      [merge, give],
      [pullButton, pull],
    ] as const) {
      if (available) entry.hideAt = now + HOLD_BUTTON_LINGER_MS;
      const visible = available || now < entry.hideAt;
      if (visible === !entry.button.hidden) continue;
      entry.button.hidden = !visible;
      // Sumiu com o dedo em cima: larga (sem isso, o próximo encosto fundiria/puxaria sozinho).
      if (!visible) entry.release();
    }
  }

  private renderTouchLabels(): void {
    if (!this.touchBar) return;
    this.touchBar.querySelector('[data-touch-emote]')?.setAttribute('aria-label', t('emote.open'));
    const [merge, pull] = this.holdButtons;
    merge?.button.setAttribute('aria-label', t('mp.mergeButton'));
    pull?.button.setAttribute('aria-label', t('mp.pullButton'));
  }

  private renderChip(): void {
    const net = this.net;
    this.chip.hidden = !net.active;
    if (this.touchBar) this.touchBar.hidden = !net.active;
    if (!net.active) {
      for (const plate of this.plates) plate.hidden = true;
      for (const ping of this.pingEls) ping.hidden = true;
      this.wheel.hide();
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

  /** Placas (e balões) deste quadro, projetadas na tela pela câmera; e os marcadores "Aqui!". */
  setNameplates(sources: readonly NameplateSource[], camera: THREE.Camera): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const placed = this.placed;
    placed.length = 0;
    for (let i = 0; i < this.plates.length; i++) {
      const plate = this.plates[i];
      const source = sources[i];
      if (!source) {
        plate.hidden = true;
        continue;
      }
      const talking = source.emote >= 0;
      const distance = camera.position.distanceTo(source.position);
      tmp.copy(source.position).project(camera);
      const behind = tmp.z > 1 || tmp.z < -1;
      const far = talking ? BUBBLE_FAR : PLATE_FAR;
      if (behind || distance > far || distance < PLATE_NEAR || Math.abs(tmp.x) > 1.05 || Math.abs(tmp.y) > 1.05 || (!source.nick && !talking)) {
        plate.hidden = true;
        continue;
      }
      const key = `${source.slot}|${source.nick}|${source.tag}|${source.isHost}|${source.emote}|${source.dizzy}|${source.team}`;
      const changed = this.shown.get(plate) !== key;
      if (changed) {
        this.shown.set(plate, key);
        plate.dataset.slot = String(source.slot);
        // Com time, a placa fica na cor do time e ganha o ícone dele (a cor nunca vem sozinha).
        if (source.team >= 0) plate.dataset.team = String(source.team);
        else delete plate.dataset.team;
        plate.classList.toggle('is-self', !source.nick);
        const bubble = talking
          ? `<span class="nameplate__bubble">${EMOTE_ICONS[source.emote] ?? ''}<span>${escapeHtml(t(`emote.${source.emote}` as MessageKey))}</span></span>`
          : '';
        const name = source.nick
          ? `<span class="nameplate__tag">${source.team >= 0 ? `<span class="nameplate__team">${TEAM_ICONS[source.team] ?? ''}</span>` : ''}${source.isHost ? `<span class="nameplate__crown">${Icons.crown}</span>` : ''}${clanTagHtml(source.tag, 'clan-tag--plate')}<span class="nameplate__nick">${escapeHtml(source.nick)}</span></span>`
          : '';
        plate.innerHTML = bubble + name;
      }
      plate.hidden = false;
      let size = this.sizes.get(plate);
      if (changed || !size) {
        size = { w: plate.offsetWidth, h: plate.offsetHeight };
        this.sizes.set(plate, size);
      }
      // Longe fica um pouco menor e mais transparente (profundidade sem poluir); o balão fica inteiro.
      const fade = talking ? 1 : 1 - Math.min(1, Math.max(0, (distance - 18) / (PLATE_FAR - 18)));
      placed.push({
        plate,
        x: (tmp.x * 0.5 + 0.5) * width,
        y: (-tmp.y * 0.5 + 0.5) * height,
        w: size.w,
        h: size.h,
        scale: 0.8 + fade * 0.2,
        opacity: 0.45 + fade * 0.55,
        distance,
      });
    }
    spreadPlates(placed);
    for (const e of placed) {
      e.plate.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px) translate(-50%, -100%) scale(${e.scale.toFixed(3)})`;
      e.plate.style.opacity = e.opacity.toFixed(2);
    }
    this.renderPings(camera, width, height);
  }

  /** Marcadores "Aqui!": em cima do ponto, ou presos na borda apontando pra ele. */
  private renderPings(camera: THREE.Camera, width: number, height: number): void {
    const pings = this.net.active ? this.net.pings : [];
    const margins: ScreenMargins = { top: 110, bottom: 90, side: 56 };
    for (let i = 0; i < this.pingEls.length; i++) {
      const el = this.pingEls[i];
      const ping = pings[i];
      if (!ping) {
        el.hidden = true;
        continue;
      }
      tmp.copy(ping.position);
      tmp.y += 1.2;
      const view = tmp.clone().applyMatrix4(camera.matrixWorldInverse);
      tmp.project(camera);
      const place = placeMarker({ ndcX: tmp.x, ndcY: tmp.y, behind: view.z > 0 }, margins, width, height);
      el.hidden = false;
      el.dataset.slot = String(ping.slot);
      el.classList.toggle('is-edge', !place.onScreen);
      el.style.transform = `translate(${place.x.toFixed(1)}px, ${place.y.toFixed(1)}px) translate(-50%, -100%)`;
      (el.lastElementChild as HTMLElement).style.transform = `rotate(${place.angle.toFixed(1)}deg)`;
    }
  }
}
