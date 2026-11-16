// hud.js — one job: every DOM pixel the player sees.
// The 3D scene never draws UI; this module owns the overlay, the buy menu and banners.
import { WEAPONS, GRENADE_PRICE } from './weapons.js';
import { BUY_TIME, ROUND_TIME } from './rounds.js';

export class Hud {
  constructor(doc) {
    this.d = doc;
    this.el = {};
    for (const id of ['hp-num', 'hp-bar', 'ammo-mag', 'ammo-reserve', 'timer', 'score-v', 'score-s',
      'money', 'feed', 'banner', 'banner-sub', 'overlay', 'overlay-title', 'overlay-copy', 'play',
      'buy', 'buy-money', 'buy-list', 'crosshair', 'hitmarker', 'dmg', 'prompt', 'plant-bar',
      'plant-fill', 'bomb-line', 'alive-v', 'alive-s', 'weapon-name']) {
      this.el[id] = doc.getElementById(id);
    }
    this._last = {};
  }
  _set(key, value) {
    if (this._last[key] !== value) {
      this._last[key] = value;
      return true;
    }
    return false;
  }
  showOverlay(title, copy, button) {
    this.el['overlay-title'].textContent = title;
    this.el['overlay-copy'].textContent = copy;
    this.el['play'].textContent = button;
    this.el.overlay.hidden = false;
  }
  hideOverlay() {
    this.el.overlay.hidden = true;
  }
  showBuy(state, list) {
    const b = this.el.buy;
    b.hidden = false;
    this.el['buy-money'].textContent = '$' + state.money[0];
    // The pistol is free and always owned; the menu sells rifle (1), SMG (2),
    // sniper (3), grenade (4) and an ammo refill (5) — the same keys applyBuy uses.
    const rows = list.filter((w) => w.key !== 'pistol').map((w, i) => {
      const price = w.owned ? (w.current ? 'EQUIPPED' : 'OWNED') : '$' + w.price;
      return `<div class="buy-row${w.current ? ' cur' : ''}"><span class="buy-key">${i + 1}</span><span class="buy-name">${w.name}</span><span class="buy-price">${price}</span></div>`;
    }).join('');
    const g = state.player.grenades;
    this.el['buy-list'].innerHTML = rows
      + `<div class="buy-row"><span class="buy-key">4</span><span class="buy-name">Frag grenade (${g}/2)</span><span class="buy-price">$${GRENADE_PRICE}</span></div>`
      + `<div class="buy-row"><span class="buy-key">5</span><span class="buy-name">Refill ammo — current weapon</span><span class="buy-price">$200</span></div>`
      + `<div class="buy-note">B to close · money is shared across rounds · first to 5 rounds wins the match</div>`;
  }
  hideBuy() {
    this.el.buy.hidden = true;
  }
  banner(title, sub) {
    this.el.banner.textContent = title;
    this.el['banner-sub'].textContent = sub || '';
    this.el.banner.classList.add('show');
    this.el['banner-sub'].classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => {
      this.el.banner.classList.remove('show');
      this.el['banner-sub'].classList.remove('show');
    }, 2600);
  }
  update(state, spreadPx) {
    const p = state.player;
    const def = WEAPONS[p.weapon];
    const w = p.weapons[p.weapon];
    if (this._set('hp', p.hp)) {
      this.el['hp-num'].textContent = p.hp;
      this.el['hp-bar'].style.width = p.hp + '%';
      this.el['hp-bar'].style.background = p.hp > 50 ? '#e9e6df' : p.hp > 25 ? '#f0a830' : '#d43a2e';
    }
    const mag = w ? w.mag : 0;
    const res = w ? w.reserve : 0;
    if (this._set('ammo', mag + '/' + res)) {
      this.el['ammo-mag'].textContent = mag;
      this.el['ammo-reserve'].textContent = '/ ' + res;
    }
    if (this._set('weapon', p.weapon + (p.reloadT > 0 ? ' reloading' : ''))) {
      this.el['weapon-name'].textContent = def.name + (p.reloadT > 0 ? ' — RELOADING' : '');
    }
    const t = Math.max(0, Math.ceil(state.timer));
    const mm = Math.floor(t / 60);
    const ss = String(t % 60).padStart(2, '0');
    const timerText = `${mm}:${ss}`;
    if (this._set('timer', timerText + state.phase)) {
      this.el.timer.textContent = timerText;
      this.el.timer.classList.toggle('buy', state.phase === 'buy');
    }
    if (this._set('score', state.score[0] + '-' + state.score[1])) {
      this.el['score-v'].textContent = state.score[0];
      this.el['score-s'].textContent = state.score[1];
    }
    if (this._set('money', state.money[0])) {
      this.el.money.textContent = '$' + state.money[0];
    }
    const vAlive = (p.alive ? 1 : 0) + state.bots.filter((b) => b.alive && b.team === 0).length;
    const sAlive = state.bots.filter((b) => b.alive && b.team === 1).length;
    if (this._set('alive', vAlive + '/' + sAlive)) {
      this.el['alive-v'].textContent = 'Vanguard ' + vAlive;
      this.el['alive-s'].textContent = 'Sentinels ' + sAlive;
    }
    // Bomb line.
    let bombText = '';
    if (state.bomb.state === 'planted') bombText = `BOMB PLANTED ${state.bomb.site} — ${Math.ceil(state.bomb.fuse)}s`;
    else if (state.bomb.state === 'dropped') bombText = 'BOMB DROPPED — pick it up';
    else if (p.hasBomb) bombText = 'YOU CARRY THE BOMB — plant at Foundry (A) or Depot (B)';
    if (this._set('bomb', bombText)) this.el['bomb-line'].textContent = bombText;
    // Crosshair gap follows spread; hitmarker and damage flash are one-shot classes.
    const gap = Math.round(4 + spreadPx);
    this.el.crosshair.style.setProperty('--gap', gap + 'px');
    // Plant progress.
    if (p.planting > 0) {
      this.el['plant-bar'].hidden = false;
      this.el['plant-fill'].style.width = Math.round((p.planting / 3) * 100) + '%';
    } else {
      this.el['plant-bar'].hidden = true;
    }
    // Prompt.
    this.el.prompt.textContent = state.phase === 'buy'
      ? (this.el.buy.hidden ? 'Press B to open the buy menu' : 'Press B to close — 1–5 to buy')
      : p.planting > 0 ? 'Planting…' : '';
    // Kill feed (last 4).
    const feed = state.feed.slice(-4).map((f) => f.text).join('\n');
    if (this._set('feed', feed)) this.el.feed.textContent = feed;
    if (this._set('round', state.round)) {
      this.el['banner-sub'].dataset.round = state.round;
    }
    // Damage vignette.
    this.el.dmg.style.opacity = p.hurtT > 0 ? '0.55' : '0';
  }
  hitmark(head) {
    this.el.hitmarker.classList.add('on');
    this.el.hitmarker.classList.toggle('head', !!head);
    clearTimeout(this._hitT);
    this._hitT = setTimeout(() => this.el.hitmarker.classList.remove('on'), 110);
  }
}
