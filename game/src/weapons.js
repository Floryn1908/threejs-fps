// weapons.js — one job: weapon definitions, firing, recoil/spread, reload, grenades.
// Hits are raycasts against bot hit meshes (head sphere / body box); damage, spread and
// recoil all punish firing on the move, so stopping to aim pays.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    name: 'P9 Sidearm', price: 0, auto: false, rpm: 240, mag: 12, reserve: 48,
    damage: 26, headMul: 2, reload: 1.6, spread: 0.011, moveSpread: 2.0,
    recoil: 0.011, range: 45, tracer: 0xffffff,
  },
  rifle: {
    name: 'AR-9 Ember', price: 2700, auto: true, rpm: 600, mag: 30, reserve: 120,
    damage: 34, headMul: 2.5, reload: 2.2, spread: 0.008, moveSpread: 2.2,
    recoil: 0.016, range: 60, tracer: 0xffd27a,
  },
  smg: {
    name: 'VK-5 Rasp', price: 1500, auto: true, rpm: 800, mag: 28, reserve: 112,
    damage: 22, headMul: 2, reload: 1.9, spread: 0.014, moveSpread: 1.8,
    recoil: 0.009, range: 35, tracer: 0xffe9a8,
  },
  sniper: {
    name: 'LW-88 Longbow', price: 4750, auto: false, rpm: 65, mag: 5, reserve: 20,
    damage: 95, headMul: 2, reload: 3.2, spread: 0.001, moveSpread: 4.5,
    recoil: 0.055, range: 90, tracer: 0x9fd8ff,
  },
};
export const GRENADE_PRICE = 300;
export const GRENADE_MAX = 2;

const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _ray = new THREE.Raycaster();

// Fire one hitscan shot for the player. Returns 'hit' | 'head' | 'miss' | 'dry' | 'none'.
export function firePlayerShot(state, map, scene, hitMeshes, audio, tracers) {
  const p = state.player;
  const def = WEAPONS[p.weapon];
  if (p.reloadT > 0 || p.fireT > 0) return 'none';
  const w = p.weapons[p.weapon];
  if (!w) return 'none';
  if (w.mag <= 0) {
    audio.dryFire();
    p.fireT = 0.25;
    return 'dry';
  }
  p.fireT = 60 / def.rpm;
  w.mag -= 1;
  // Spread: base + bloom + movement/air/crouch modifiers.
  const moving = Math.hypot(p.vel.x, p.vel.z) > 0.6;
  let spread = def.spread + p.bloom;
  if (moving) spread *= def.moveSpread;
  if (!p.onGround) spread *= 1.6;
  if (p.crouch) spread *= 0.6;
  const yaw = p.yaw + (Math.random() - 0.5) * 2 * spread;
  const pitch = p.pitch + (Math.random() - 0.5) * 2 * spread;
  _dir.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).normalize();
  const eyeY = p.crouch ? 1.05 : 1.62;
  _origin.set(p.pos.x, eyeY, p.pos.z);
  _ray.set(_origin, _dir);
  _ray.far = def.range;
  const hits = _ray.intersectObjects(hitMeshes, false);
  // Recoil kicks the view up and blooms the next shots.
  p.recoil = Math.min(p.recoil + def.recoil, 0.09);
  p.bloom = Math.min(p.bloom + def.spread * 0.9, 0.05);
  audio.shot(p.weapon);
  // Tracer from the muzzle to the hit point (or max range).
  const end = hits.length ? hits[0].point : _origin.clone().add(_dir.clone().multiplyScalar(def.range));
  tracers.spawn(_origin, end, def.tracer);
  if (!hits.length) return 'miss';
  const h = hits[0];
  const meta = h.object.userData;
  if (!meta || meta.bot == null) return 'miss';
  const bot = state.bots[meta.bot];
  if (!bot || !bot.alive) return 'miss';
  const dmg = Math.round(def.damage * (meta.part === 'head' ? def.headMul : 1));
  return { hit: meta.part === 'head' ? 'head' : 'hit', bot, dmg };
}

export function startReload(state, audio) {
  const p = state.player;
  const def = WEAPONS[p.weapon];
  const w = p.weapons[p.weapon];
  if (!w || p.reloadT > 0 || w.mag >= def.mag || w.reserve <= 0) return false;
  p.reloadT = def.reload;
  p.reloadTotal = def.reload;
  audio.reload();
  return true;
}

export function finishReload(state) {
  const p = state.player;
  const def = WEAPONS[p.weapon];
  const w = p.weapons[p.weapon];
  if (!w) return;
  const need = def.mag - w.mag;
  const take = Math.min(need, w.reserve);
  w.mag += take;
  w.reserve -= take;
}

export function buyWeapon(state, key) {
  const def = WEAPONS[key];
  if (!def || key === 'pistol') return false;
  if (state.player.weapons[key]) return false; // already owned
  if (state.money[0] < def.price) return false;
  state.money[0] -= def.price;
  state.player.weapons[key] = { mag: def.mag, reserve: def.reserve };
  state.player.weapon = key;
  return true;
}

export function buyGrenade(state) {
  if (state.player.grenades >= GRENADE_MAX) return false;
  if (state.money[0] < GRENADE_PRICE) return false;
  state.money[0] -= GRENADE_PRICE;
  state.player.grenades += 1;
  return true;
}

export function buyAmmo(state) {
  const p = state.player;
  const def = WEAPONS[p.weapon];
  const w = p.weapons[p.weapon];
  if (!w || w.reserve >= def.reserve) return false;
  if (state.money[0] < 200) return false;
  state.money[0] -= 200;
  w.reserve = def.reserve;
  return true;
}

// Live grenades: simple gravity + floor bounce, fuse then radius damage.
export function stepGrenades(state, map, dt, onExplode) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 14 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    if (g.pos.y < 0.15) {
      g.pos.y = 0.15;
      g.vel.y = -g.vel.y * 0.35;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    if (g.fuse <= 0) {
      state.grenades.splice(i, 1);
      onExplode(g);
    }
  }
}

export function throwGrenade(state, audio) {
  const p = state.player;
  if (p.grenades <= 0 || p.reloadT > 0) return false;
  p.grenades -= 1;
  const speed = 13;
  const dir = new THREE.Vector3(
    -Math.sin(p.yaw) * Math.cos(p.pitch),
    Math.sin(p.pitch) + 0.25,
    -Math.cos(p.yaw) * Math.cos(p.pitch),
  ).normalize();
  state.grenades.push({
    pos: { x: p.pos.x, y: p.crouch ? 1.1 : 1.6, z: p.pos.z },
    vel: { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed },
    fuse: 1.6,
    team: 0,
  });
  audio.shot('pistol');
  return true;
}
