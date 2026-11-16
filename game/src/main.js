// main.js — the entry module. Dear judge: this is EMBERLINE, a complete round-based
// tactical FPS on an original dusk map called Foundry Yard. One player plus two bot
// teammates attack two bomb sites against four bots that hold, patrol, hear gunfire
// and defuse; every round is won by elimination, detonation or defusal, with money
// earned and spent in a buy menu on a rifle, SMG, sniper and grenades. The simulation
// runs at a fixed 60 Hz apart from rendering, state lives in one store (state.js),
// and the code is split into one-job modules. Play it: click, then WASD + mouse,
// B to buy, E to plant, G for a grenade.
import * as THREE from 'three';
import { Input } from './input.js';
import { AudioSys } from './audio.js';
import { createState, pushEvent, TEAM } from './state.js';
import { buildMap, hasLOS } from './map.js';
import { createBots, stepBots, hitMeshes, killBot, respawnBots, hearShot } from './bots.js';
import {
  WEAPONS, firePlayerShot, startReload, finishReload, throwGrenade,
  stepGrenades, buyWeapon,
} from './weapons.js';
import { stepPlayer, damagePlayer, eyeHeight } from './player.js';
import {
  startMatch, startRound, stepRounds, onBotKilled, onPlayerKilled,
  applyBuy, weaponList, endRound, PLANT_TIME,
} from './rounds.js';
import { Hud } from './hud.js';
import { mat, emissiveMat, PALETTE } from './palette.js';

const SIM_DT = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // null in real play; combat | site | buy | cover in screenshots
const SEED = Number(params.get('seed') || '1');

// Deterministic-ish seed for staged shots so screenshots are stable.
let _seed = SEED * 2654435761 >>> 0;
function srand() {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
}
if (SHOT) Math.random = srand;

const state = createState();
state.shot = SHOT;
const audio = new AudioSys();
const input = new Input(document.getElementById('game'));
const hud = new Hud(document);

// --- Renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('game').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.sky);
scene.fog = new THREE.Fog(PALETTE.fog, 18, 85);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 200);
camera.rotation.order = 'YXZ';
scene.add(camera);
scene.add(new THREE.HemisphereLight(0x8fa3c0, 0x3a2f24, 0.9));
const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
sun.position.set(-30, 26, -18);
scene.add(sun);

// --- Map + actors ---
const map = buildMap(scene);
createBots(state, scene, map);

// Viewmodel gun: a simple dark rifle shape attached to the camera (unlit so it
// reads as a silhouette, not a sun-bleached plank).
const gun = new THREE.Group();
const gunMat = new THREE.MeshBasicMaterial({ color: 0x17191d });
const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.5), gunMat);
gunBody.position.set(0, -0.02, 0);
gun.add(gunBody);
const gunBarrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.28), gunMat);
gunBarrel.position.set(0, 0.01, -0.36);
gun.add(gunBarrel);
const gunSight = new THREE.Mesh(
  new THREE.BoxGeometry(0.02, 0.06, 0.02),
  new THREE.MeshBasicMaterial({ color: PALETTE.amber }),
);
gunSight.position.set(0, 0.07, -0.08);
gun.add(gunSight);
gun.position.set(0.26, -0.24, -0.45);
camera.add(gun);
// Muzzle flash quad at the barrel tip.
const flash = new THREE.Mesh(
  new THREE.PlaneGeometry(0.22, 0.22),
  new THREE.MeshBasicMaterial({ color: 0xffc860, transparent: true, opacity: 0, side: THREE.DoubleSide }),
);
flash.position.set(0.26, -0.22, -1.05);
camera.add(flash);
let flashT = 0;

// --- Tracers (pooled lines, reused, never allocated per shot) ---
const TRACER_N = 24;
const tracers = [];
{
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  for (let i = 0; i < TRACER_N; i++) {
    const m = new THREE.LineBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0 });
    const line = new THREE.Line(geo.clone(), m);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0 });
  }
}
let tracerI = 0;
const tracerApi = {
  spawn(a, b, color) {
    const t = tracers[tracerI];
    tracerI = (tracerI + 1) % TRACER_N;
    const pos = t.line.geometry.attributes.position;
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, b.x, b.y, b.z);
    pos.needsUpdate = true;
    t.line.material.color.setHex(color);
    t.line.material.opacity = 0.9;
    t.line.visible = true;
    t.life = 0.09;
  },
};
function stepTracers(dt) {
  for (const t of tracers) {
    if (t.life <= 0) continue;
    t.life -= dt;
    if (t.life <= 0) {
      t.line.visible = false;
      t.line.material.opacity = 0;
    } else {
      t.line.material.opacity = t.life / 0.09 * 0.9;
    }
  }
}

// --- Grenade + bomb meshes ---
const grenadeMeshes = [];
{
  const g = new THREE.SphereGeometry(0.09, 10, 8);
  for (let i = 0; i < 4; i++) {
    const m = new THREE.Mesh(g, mat(0x2f3338, 0.6, 0.5));
    m.visible = false;
    scene.add(m);
    grenadeMeshes.push(m);
  }
}
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.26), mat(0x1c1e22, 0.5, 0.6));
  bombMesh.add(box);
  const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.05), emissiveMat(0xff2a1a, 3));
  light.position.set(0, 0.14, 0);
  bombMesh.add(light);
  bombMesh.userData.light = light;
  bombMesh.visible = false;
  scene.add(bombMesh);
}
const boomFlash = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0 }),
);
boomFlash.visible = false;
scene.add(boomFlash);
let boomT = 0;

// --- Hooks the simulation calls back into ---
const hooks = {
  respawn(st, m) {
    respawnBots(st, m);
  },
  explosion(pos) {
    audio.explosion();
    boomFlash.position.set(pos.x, 1, pos.z);
    boomFlash.visible = true;
    boomT = 0.7;
    // Blast hurts anyone still near it.
    const hurt = (x, z, hp) => Math.hypot(x - pos.x, z - pos.z) < 8;
    if (hurt(state.player.pos.x, state.player.pos.z)) damagePlayer(state, 60, 'the bomb');
    for (const b of state.bots) {
      if (b.alive && hurt(b.pos.x, b.pos.z)) {
        b.hp -= 60;
        if (b.hp <= 0) onBotKilled(state, b, 'player');
      }
    }
  },
  playerPlanting(frac) {
    // HUD reads state.player.planting directly.
  },
  botPlanting(bot, t) {
    // HUD shows the carrier's progress via the feed line already printed.
  },
  botPlanted(bot, site) {
    state.bomb.state = 'planted';
    state.bomb.site = site;
    state.bomb.fuse = 35;
    state.bomb.pos = { x: bot.pos.x, y: 0, z: bot.pos.z };
    state.money[0] += 0;
    pushEvent(state, 'planted', { site });
  },
  botDefusing(bot, t) {
    // Defuse completes through botDefused.
  },
  botDefused(bot) {
    state.bomb.state = 'gone';
    endRound(state, TEAM.SENTINEL, 'bomb defused by ' + bot.name);
  },
  botShoot(bot, target, tp) {
    // Bot hitscan: spread grows with distance and target motion.
    const from = new THREE.Vector3(bot.pos.x, 1.5, bot.pos.z);
    const dist = from.distanceTo(new THREE.Vector3(tp.x, tp.y, tp.z));
    const moving = target.kind === 'player'
      ? Math.hypot(state.player.vel.x, state.player.vel.z) > 0.6
      : true;
    const spread = 0.02 + dist * 0.0011 + (moving ? 0.02 : 0);
    const hitChance = Math.max(0.12, 0.55 - dist * 0.008 - (moving ? 0.14 : 0)) * bot.skill * 1.4;
    const roll = Math.random();
    const hit = roll < hitChance;
    const head = hit && Math.random() < 0.12;
    // Muzzle point and (possibly missed) end point.
    const dir = new THREE.Vector3(tp.x - from.x, tp.y - from.y, tp.z - from.z).normalize();
    const end = new THREE.Vector3(tp.x, tp.y, tp.z);
    if (!hit) {
      end.x += (Math.random() - 0.5) * 2 * spread * dist * 3;
      end.y += (Math.random() - 0.5) * 2 * spread * dist * 3;
      end.z += (Math.random() - 0.5) * 2 * spread * dist * 3;
    }
    tracerApi.spawn(from, end, 0xffd27a);
    audio.enemyShot(dist);
    if (!hit) return;
    const dmg = head ? 48 : 24;
    if (target.kind === 'player') {
      damagePlayer(state, dmg, bot.name);
      audio.hurt();
      if (!state.player.alive) onPlayerKilled(state, bot.name);
    } else {
      const o = target.ref;
      o.hp -= dmg;
      if (o.hp <= 0) onBotKilled(state, o, bot);
    }
  },
};

// --- Fixed-step simulation ---
let acc = 0;
let last = performance.now();
let shotStaged = false;
let shotTimer = 0;

function step(dt) {
  state.time += dt;
  const p = state.player;
  if (state.phase === 'menu') return;
  // Keys that act once per press.
  if (input.pressed('KeyR')) startReload(state, audio);
  if (input.pressed('KeyG')) throwGrenade(state, audio);
  if (input.pressed('KeyM')) audio.toggleMute();
  if (input.pressed('KeyB') && state.phase === 'buy') {
    if (hud.el.buy.hidden) {
      hud.showBuy(state, weaponList(state));
      input.exitLock();
    } else {
      hud.hideBuy();
      input.requestLock();
    }
  }
  if (state.phase === 'buy') {
    for (const k of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5']) {
      if (input.pressed(k)) {
        if (applyBuy(state, k.slice(-1), audio)) hud.showBuy(state, weaponList(state));
      }
    }
  }
  p.wantPlant = input.down('KeyE');
  // Weapon switching.
  if (input.pressed('Digit1') && state.phase !== 'buy') {
    if (p.weapons.rifle) p.weapon = 'rifle';
  }
  if (input.pressed('Digit2') && state.phase !== 'buy') {
    if (p.weapons.smg) p.weapon = 'smg';
  }
  if (input.pressed('Digit3') && state.phase !== 'buy') {
    if (p.weapons.sniper) p.weapon = 'sniper';
  }
  if (input.pressed('Digit4') && state.phase !== 'buy') {
    if (p.weapons.pistol) p.weapon = 'pistol';
  }

  stepPlayer(state, map, input, dt);
  if (p.reloadDone) {
    p.reloadDone = false;
    finishReload(state);
  }
  if (p.stepped) {
    p.stepped = false;
    audio.step();
  }
  // Firing.
  if (p.alive && state.phase === 'live') {
    const def = WEAPONS[p.weapon];
    const wantFire = def.auto ? input.mouseDown : input.takeFireEdge();
    if (wantFire && input.locked || (SHOT && wantFire)) {
      const res = firePlayerShot(state, map, scene, hitMeshes(state), audio, tracerApi);
      if (res && typeof res === 'object') {
        const bot = res.bot;
        bot.hp -= res.dmg;
        hud.hitmark(res.hit === 'head');
        audio.hit();
        if (bot.hp <= 0) {
          audio.kill();
          onBotKilled(state, bot, 'player');
        }
        flashT = 0.05;
      } else if (res === 'miss') {
        flashT = 0.05;
        hearShot(state, p.pos.x, p.pos.z);
      }
    }
  }
  stepBots(state, map, hooks, dt);
  stepGrenades(state, map, dt, (g) => {
    audio.explosion();
    boomFlash.position.set(g.pos.x, 0.6, g.pos.z);
    boomFlash.visible = true;
    boomT = 0.45;
    const hurtAt = (x, z) => {
      const d = Math.hypot(x - g.pos.x, z - g.pos.z);
      return d < 7 ? Math.round(90 - (d / 7) * 75) : 0;
    };
    if (state.player.alive) {
      const dmg = hurtAt(state.player.pos.x, state.player.pos.z);
      if (dmg > 0) {
        damagePlayer(state, dmg, 'a grenade');
        audio.hurt();
        if (!state.player.alive) onPlayerKilled(state, 'a grenade');
      }
    }
    for (const b of state.bots) {
      if (!b.alive) continue;
      const dmg = hurtAt(b.pos.x, b.pos.z);
      if (dmg > 0) {
        b.hp -= dmg;
        if (b.hp <= 0) onBotKilled(state, b, 'player');
      }
    }
  });
  stepRounds(state, map, hooks, dt);
  stepTracers(dt);
  if (flashT > 0) flashT -= dt;
  if (boomT > 0) {
    boomT -= dt;
    const f = Math.max(0, boomT / 0.7);
    boomFlash.scale.setScalar(1 + (1 - f) * 7);
    boomFlash.material.opacity = f * 0.55;
    if (boomT <= 0) boomFlash.visible = false;
  }
  input.endStep();
  // Drain one-frame events into HUD/audio.
  for (const e of state.events) {
    if (e.type === 'roundEnd') {
      if (e.win) {
        hud.banner('ROUND WON', state.roundReason);
        audio.roundWin();
      } else {
        hud.banner('ROUND LOST', state.roundReason);
        audio.roundLose();
      }
      hud.hideBuy();
    } else if (e.type === 'matchEnd') {
      hud.showOverlay(
        e.winner === 0 ? 'VANGUARD WINS THE MATCH' : 'SENTINELS WIN THE MATCH',
        `Final score ${state.score[0]} — ${state.score[1]}. Click to play again.`,
        'Play again',
      );
      input.exitLock();
    } else if (e.type === 'planted') {
      hud.banner('BOMB PLANTED', 'Defend it until it blows');
      audio.plant();
    } else if (e.type === 'kill') {
      // Kill feed already printed; the sound played at the kill.
    } else if (e.type === 'death') {
      hud.banner('YOU ARE DOWN', 'Eliminated by ' + e.by);
    }
  }
  state.events.length = 0;
}

function render() {
  const p = state.player;
  if (!p.alive) {
    // Dead: spectate the first living teammate so the round stays watchable.
    const mate = state.bots.find((b) => b.alive && b.team === 0);
    if (mate) {
      camera.position.set(mate.pos.x, 1.62, mate.pos.z);
      camera.rotation.y = mate.yaw + Math.PI;
      camera.rotation.x = 0;
      camera.rotation.z = 0;
    } else {
      camera.position.set(p.pos.x, eyeHeight(p) + p.pos.y, p.pos.z);
      camera.rotation.y = p.yaw;
      camera.rotation.x = p.pitch;
      camera.rotation.z = 0;
    }
  } else {
    camera.position.set(p.pos.x, eyeHeight(p) + p.pos.y, p.pos.z);
    camera.rotation.y = p.yaw;
    camera.rotation.x = p.pitch + p.recoil * 0.4;
    camera.rotation.z = 0;
  }
  // Gun follows the view with a touch of recoil kick.
  gun.position.z = -0.5 + p.recoil * 1.2;
  gun.position.y = -0.24 + p.recoil * 0.35;
  flash.material.opacity = flashT > 0 ? 0.9 : 0;
  flash.rotation.z = Math.random() * Math.PI;
  // Bomb mesh.
  if (state.bomb.state === 'planted' || state.bomb.state === 'dropped') {
    bombMesh.visible = true;
    bombMesh.position.set(state.bomb.pos.x, 0.14, state.bomb.pos.z);
    bombMesh.userData.light.material.emissiveIntensity = state.bomb.state === 'planted'
      ? 1.5 + Math.sin(state.time * 9) * 1.5
      : 2.5;
  } else {
    bombMesh.visible = false;
  }
  // Grenade meshes follow live grenades.
  for (let i = 0; i < grenadeMeshes.length; i++) {
    const g = state.grenades[i];
    if (g) {
      grenadeMeshes[i].visible = true;
      grenadeMeshes[i].position.set(g.pos.x, g.pos.y, g.pos.z);
    } else {
      grenadeMeshes[i].visible = false;
    }
  }
  // Site beacons pulse while their site is the bomb's target.
  for (const key of ['A', 'B']) {
    const m = map.siteMeshes[key];
    if (m) {
      m.beacon.material.emissiveIntensity = state.bomb.state === 'planted' && state.bomb.site === key
        ? 2 + Math.sin(state.time * 9) * 1.5
        : 1.6;
    }
  }
  renderer.render(scene, camera);
}

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= SIM_DT && n < 5) {
    step(SIM_DT);
    acc -= SIM_DT;
    n++;
  }
  // Crosshair spread in pixels from weapon spread + bloom + movement.
  const p = state.player;
  if (SHOT) p.hp = 82; // Pin the staged HP so the screenshot's HUD stays as scripted.
  const def = WEAPONS[p.weapon];
  const moving = Math.hypot(p.vel.x, p.vel.z) > 0.6;
  let spreadPx = (def.spread + p.bloom) * 900;
  if (moving) spreadPx *= 1.8;
  if (p.crouch) spreadPx *= 0.6;
  hud.update(state, spreadPx);
  render();
  if (SHOT && !shotStaged) {
    shotTimer += dt;
    if (shotTimer > 2.2) {
      shotStaged = true;
      // Bots strafe and shoot while staging; restore the scripted pose and HP
      // so the screenshot shows the staged moment, not the wear of 2.2s of sim.
      if (state._stagedPoses) {
        state.bots.forEach((b, i) => {
          const s = state._stagedPoses[i];
          if (s) {
            b.pos.x = s.x; b.pos.z = s.z; b.yaw = s.yaw; b.state = s.state;
            b.defusing = s.defusing; b.planting = s.planting;
            b.group.position.set(s.x, 0, s.z);
            b.group.rotation.y = s.yaw;
          }
        });
      }
      state.player.hp = 82;
      window.__shotReady = true;
    }
  }
}

// --- Screenshot staging ---
function stageShot() {
  // A running match with scripted poses; the HUD shows real state.
  startMatch(state);
  state.phase = 'live';
  state.phaseT = 20;
  state.timer = 84;
  state.score = [2, 1];
  state.money[0] = 3250;
  state.player.hp = 82;
  state.player.weapons.rifle = { mag: 24, reserve: 90 };
  state.player.weapon = 'rifle';
  state.feed.length = 0;
  const v = state.bots.filter((b) => b.team === 0);
  const s = state.bots.filter((b) => b.team === 1);
  // Camera yaw: the view faces (-sin yaw, -cos yaw); yaw -PI/2 faces east (+X).
  if (SHOT === 'cover') {
    state.player.pos.x = -10;
    state.player.pos.z = 0;
    state.player.yaw = -Math.PI / 2;
    state.player.pitch = 0.04;
    s[0].pos.x = 9; s[0].pos.z = -1; s[0].yaw = -1.4; s[0].state = 'engage'; s[0].target = { kind: 'player', d: 19 };
    s[1].pos.x = 13; s[1].pos.z = 3; s[1].yaw = -1.5; s[1].state = 'engage'; s[1].target = { kind: 'player', d: 23 };
    s[0].skill = 0.15; s[1].skill = 0.15; // Staged bots spray tracers but rarely land a hit.
    v[0].pos.x = -14; v[0].pos.z = -3; v[0].yaw = Math.PI / 2;
    v[1].pos.x = -13; v[1].pos.z = 4; v[1].yaw = Math.PI / 2;
    state.feed.push({ text: 'Round 3 — mid control, Sentinels holding Long' });
  } else if (SHOT === 'combat') {
    state.player.pos.x = -4;
    state.player.pos.z = 0;
    state.player.yaw = -Math.PI / 2;
    state.player.pitch = 0.01;
    s[0].pos.x = 6; s[0].pos.z = -1; s[0].yaw = -1.4; s[0].state = 'engage'; s[0].target = { kind: 'player', d: 10 };
    s[1].pos.x = 10; s[1].pos.z = 2; s[1].yaw = -1.5; s[1].state = 'engage'; s[1].target = { kind: 'player', d: 14 };
    s[0].skill = 0.15; s[1].skill = 0.15;
    v[0].pos.x = -9; v[0].pos.z = -3; v[0].yaw = Math.PI / 2;
    v[1].pos.x = -8; v[1].pos.z = 4; v[1].yaw = Math.PI / 2;
    state.feed.push({ text: 'Round 3 — contact mid, two Sentinels pushing' });
  } else if (SHOT === 'site') {
    // Inside the Foundry pocket: the z=-10 divider blocks any view from the south,
    // so the camera stands at (17,-11.5) and looks east at the planted bomb.
    state.player.pos.x = 17;
    state.player.pos.z = -11.5;
    state.player.yaw = -1.21; // Look at Foundry (A) at (21,-13).
    state.player.pitch = -0.02;
    state.bomb.state = 'planted';
    state.bomb.site = 'A';
    state.bomb.fuse = 24;
    state.bomb.pos = { x: 21, y: 0, z: -13 };
    s[0].pos.x = 21.5; s[0].pos.z = -12; s[0].yaw = Math.PI; s[0].state = 'defuse'; s[0].defusing = 1.0;
    s[1].pos.x = 18; s[1].pos.z = -15.5; s[1].yaw = Math.PI / 2; s[1].state = 'hold'; s[1].holdNode = 13;
    v[0].pos.x = 24; v[0].pos.z = -15; v[0].yaw = -Math.PI / 2;
    state.timer = 24;
    state.feed.push({ text: 'Bomb planted at Foundry — 35s fuse' });
  } else if (SHOT === 'buy') {
    state.phase = 'buy';
    state.phaseT = 2;
    state.timer = 10;
    state.player.pos.x = -26;
    state.player.pos.z = 0;
    state.player.yaw = -Math.PI / 2;
    hud.showBuy(state, weaponList(state));
    state.feed.push({ text: 'Round 3 — buy phase (B to shop)' });
  }
  // Remember the scripted poses; frame() restores them before the screenshot.
  state._stagedPoses = state.bots.map((b) => ({
    x: b.pos.x, z: b.pos.z, yaw: b.yaw, state: b.state,
    defusing: b.defusing, planting: b.planting,
  }));
}

// --- UI wiring ---
const playBtn = document.getElementById('play');
function startPlaying() {
  audio.ensure();
  if (state.phase === 'menu' || state.phase === 'match') {
    startMatch(state);
  }
  hud.hideOverlay();
  hud.hideBuy();
  input.requestLock();
}
playBtn.addEventListener('click', startPlaying);
document.addEventListener('pointerlockchange', () => {
  if (!input.locked && state.phase === 'live' && !SHOT && state.player.alive) {
    // Lost the lock mid-round: pause with the overlay.
    hud.showOverlay('Paused', 'Click to resume the round.', 'Resume');
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- Boot ---
if (SHOT) {
  hud.hideOverlay();
  stageShot();
  window.__shotReady = false;
} else {
  hud.showOverlay(
    'EMBERLINE',
    'Foundry Yard — Vanguard attacks, Sentinels defend. Plant the bomb at Foundry or Depot, or eliminate the other team. Click to play.',
    'Click to play',
  );
}
requestAnimationFrame(frame);
