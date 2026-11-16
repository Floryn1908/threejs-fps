// bots.js — one job: bot bodies, senses and tactics.
// Bots walk a waypoint graph (BFS), hold positions, patrol, react to sight and sound,
// strafe and burst-fire when they see an enemy, plant the bomb and defuse it.
import * as THREE from 'three';
import { mat, PALETTE } from './palette.js';
import { collideCircle, hasLOS, findPath, nearestWaypoint } from './map.js';

const BOT_NAMES = {
  0: ['Ash', 'Brick'],
  1: ['Vex', 'Rook', 'Hale', 'Mira'],
};
const BOT_SPEED = 4.3;
const BOT_RADIUS = 0.42;
const EYE_Y = 1.5;

let nextId = 0;

function buildBody(team) {
  const g = new THREE.Group();
  const trim = team === 0 ? PALETTE.vanguard : PALETTE.sentinel;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.72, 0.34), mat(0x2c3138));
  torso.position.y = 1.05;
  g.add(torso);
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.3, 0.36), mat(trim));
  vest.position.y = 1.18;
  g.add(vest);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), mat(0x8a7a5f));
  head.position.y = 1.62;
  g.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.09, 0.1), mat(trim, 0.4, 0.4));
  visor.position.set(0, 1.64, 0.17);
  g.add(visor);
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.68, 0.24), mat(0x23272d));
    leg.position.set(s * 0.14, 0.34, 0);
    g.add(leg);
  }
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.72), mat(0x14161a, 0.5, 0.6));
  gun.position.set(0.22, 1.15, 0.3);
  g.add(gun);
  return { group: g, torso, head };
}

export function createBots(state, scene, map) {
  const bots = [];
  const mk = (team, spawn, name, skill) => {
    const { group, torso, head } = buildBody(team);
    group.position.set(spawn.x, 0, spawn.z);
    scene.add(group);
    const bot = {
      id: nextId++, team, name, skill,
      group, torso, head,
      pos: { x: spawn.x, z: spawn.z },
      yaw: team === 0 ? Math.PI / 2 : -Math.PI / 2,
      hp: 100, alive: true,
      state: 'hold', // hold | patrol | engage | plant | defuse | investigate
      path: [], pathI: 0,
      holdT: 1 + Math.random() * 2,
      thinkT: Math.random() * 0.15,
      reactT: 0,
      target: null, // 'player' or bot ref
      targetPos: null,
      burstLeft: 0, burstT: 0, pauseT: 0,
      strafeDir: Math.random() < 0.5 ? -1 : 1,
      strafeT: 0,
      hearPos: null,
      planting: 0,
      defusing: 0,
      siteGoal: null,
      patrolA: 0, patrolB: 0,
      speed: BOT_SPEED * (0.92 + Math.random() * 0.16),
      deadT: 0,
    };
    // Hit meshes (raycast targets): body box + head sphere.
    torso.userData = { bot: bot.id, part: 'body' };
    head.userData = { bot: bot.id, part: 'head' };
    bots.push(bot);
    return bot;
  };
  const vSpawns = map.spawns.vanguard;
  const sSpawns = map.spawns.sentinel;
  const v1 = mk(0, vSpawns[0], BOT_NAMES[0][0], 0.55);
  const v2 = mk(0, vSpawns[2], BOT_NAMES[0][1], 0.5);
  const s1 = mk(1, sSpawns[0], BOT_NAMES[1][0], 0.6);
  const s2 = mk(1, sSpawns[1], BOT_NAMES[1][1], 0.55);
  const s3 = mk(1, sSpawns[2], BOT_NAMES[1][2], 0.5);
  const s4 = mk(1, sSpawns[3], BOT_NAMES[1][3], 0.45);
  // Sentinel holds: two at the sites, one mid, one roaming long.
  s1.holdNode = 13; s2.holdNode = 19; s3.holdNode = 6; s4.patrolA = 8; s4.patrolB = 11; s4.state = 'patrol';
  v1.followPlayer = true; v2.followPlayer = true;
  state.bots = bots;
  return bots;
}

export function hitMeshes(state) {
  const out = [];
  for (const b of state.bots) {
    if (b.alive) {
      out.push(b.torso, b.head);
    }
  }
  return out;
}

function setPath(bot, map, goalNode) {
  const from = nearestWaypoint(map.waypoints, bot.pos.x, bot.pos.z);
  bot.path = findPath(map.adj, from, goalNode);
  bot.pathI = bot.path[0] === from ? 1 : 0;
}

function moveAlongPath(bot, map, dt) {
  if (bot.pathI >= bot.path.length) return true;
  const wp = map.waypoints[bot.path[bot.pathI]];
  const dx = wp.x - bot.pos.x;
  const dz = wp.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.6) {
    bot.pathI++;
    return bot.pathI >= bot.path.length;
  }
  const sp = bot.speed;
  bot.pos.x += (dx / d) * sp * dt;
  bot.pos.z += (dz / d) * sp * dt;
  bot.yaw = Math.atan2(dx, dz);
  collideCircle(map.colliders, bot.pos, BOT_RADIUS);
  return false;
}

function canSee(bot, tx, ty, tz, map) {
  const dx = tx - bot.pos.x;
  const dz = tz - bot.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > 42) return null;
  // Facing check (110-degree cone), except at very close range.
  if (dist > 2) {
    const ang = Math.atan2(dx, dz);
    let diff = ang - bot.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 0.96) return null;
  }
  if (!hasLOS(map.colliders, bot.pos.x, EYE_Y, bot.pos.z, tx, ty, tz)) return null;
  return dist;
}

// Pick the nearest visible enemy: the player (Sentinels only — teammates never
// target their own player) or a bot of the other team.
function acquireTarget(bot, state, map) {
  let best = null;
  let bestD = Infinity;
  const p = state.player;
  if (bot.team === 1 && p.alive) {
    const d = canSee(bot, p.pos.x, p.crouch ? 1.05 : 1.5, p.pos.z, map);
    if (d !== null && d < bestD) {
      best = { kind: 'player', d };
      bestD = d;
    }
  }
  for (const o of state.bots) {
    if (!o.alive || o.team === bot.team) continue;
    const d = canSee(bot, o.pos.x, 1.4, o.pos.z, map);
    if (d !== null && d < bestD) {
      best = { kind: 'bot', ref: o, d };
      bestD = d;
    }
  }
  return best;
}

export function hearShot(state, x, z) {
  for (const b of state.bots) {
    if (!b.alive) continue;
    const d = Math.hypot(b.pos.x - x, b.pos.z - z);
    if (d < 26 && b.state !== 'engage') {
      b.hearPos = { x, z };
      if (b.state === 'hold' || b.state === 'patrol') b.state = 'investigate';
    }
  }
}

export function stepBots(state, map, hooks, dt) {
  // Bots only fight during the live phase. In buy / over / match they hold
  // their ground (and stay out of the player's way at spawn).
  if (state.phase !== 'live') {
    for (const bot of state.bots) {
      if (!bot.alive) continue;
      bot.group.position.set(bot.pos.x, 0, bot.pos.z);
      bot.group.rotation.y = bot.yaw;
    }
    return;
  }
  for (const bot of state.bots) {
    if (!bot.alive) {
      bot.deadT += dt;
      continue;
    }
    bot.thinkT -= dt;
    // Periodic re-acquire.
    if (bot.thinkT <= 0) {
      bot.thinkT = 0.15 + Math.random() * 0.05;
      const t = acquireTarget(bot, state, map);
      if (t) {
        if (!bot.target) bot.reactT = 0.28 + (1 - bot.skill) * 0.25;
        bot.target = t;
      } else {
        bot.target = null;
        bot.reactT = 0;
      }
    }
    if (bot.target) {
      bot.reactT -= dt;
      if (bot.reactT <= 0) bot.state = 'engage';
    } else if (bot.state === 'engage') {
      bot.state = bot.team === 1 && bot.holdNode != null ? 'hold' : 'patrol';
      bot.path = [];
    }

    if (bot.state === 'engage' && bot.target) {
      // Face the target, strafe, burst fire.
      const tp = bot.target.kind === 'player'
        ? { x: state.player.pos.x, y: state.player.crouch ? 1.05 : 1.5, z: state.player.pos.z }
        : { x: bot.target.ref.pos.x, y: 1.4, z: bot.target.ref.pos.z };
      const dx = tp.x - bot.pos.x;
      const dz = tp.z - bot.pos.z;
      bot.yaw = Math.atan2(dx, dz);
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeT = 0.7 + Math.random() * 0.8;
        bot.strafeDir *= -1;
      }
      const sd = bot.strafeDir;
      const px = -dz;
      const pz = dx;
      const pl = Math.hypot(px, pz) || 1;
      bot.pos.x += (px / pl) * sd * 1.6 * dt;
      bot.pos.z += (pz / pl) * sd * 1.6 * dt;
      collideCircle(map.colliders, bot.pos, BOT_RADIUS);
      // Burst fire.
      if (bot.pauseT > 0) {
        bot.pauseT -= dt;
      } else if (bot.burstLeft > 0) {
        bot.burstT -= dt;
        if (bot.burstT <= 0) {
          bot.burstT = 0.11;
          bot.burstLeft--;
          hooks.botShoot(bot, bot.target, tp);
          if (bot.burstLeft === 0) bot.pauseT = 0.6 + Math.random() * 0.6;
        }
      } else {
        bot.burstLeft = 3 + ((Math.random() * 3) | 0);
        bot.burstT = 0;
      }
    } else if (bot.state === 'plant') {
      // Carrier walks to the chosen site and plants.
      if (bot.siteGoal == null) {
        bot.siteGoal = Math.random() < 0.5 ? 'A' : 'B';
        const node = bot.siteGoal === 'A' ? 13 : 19;
        setPath(bot, map, node);
      }
      if (moveAlongPath(bot, map, dt)) {
        bot.planting += dt;
        hooks.botPlanting(bot, bot.planting);
        if (bot.planting >= 3) {
          bot.planting = 0;
          hooks.botPlanted(bot, bot.siteGoal);
          bot.state = 'hold';
          bot.holdNode = bot.siteGoal === 'A' ? 13 : 19;
        }
      }
    } else if (bot.state === 'defuse') {
      const siteNode = state.bomb.site === 'A' ? 13 : 19;
      if (moveAlongPath(bot, map, dt)) {
        bot.defusing += dt;
        hooks.botDefusing(bot, bot.defusing);
        if (bot.defusing >= 5) {
          bot.defusing = 0;
          hooks.botDefused(bot);
          bot.state = 'hold';
          bot.holdNode = siteNode;
        }
      } else if (!bot.path.length) {
        setPath(bot, map, siteNode);
      }
    } else if (bot.state === 'investigate' && bot.hearPos) {
      const node = nearestWaypoint(map.waypoints, bot.hearPos.x, bot.hearPos.z);
      if (!bot.path.length) setPath(bot, map, node);
      if (moveAlongPath(bot, map, dt)) {
        bot.hearPos = null;
        bot.state = bot.team === 1 && bot.holdNode != null ? 'hold' : 'patrol';
        bot.path = [];
      }
    } else if (bot.state === 'patrol') {
      const goal = bot.patrolA != null ? (bot.patrolGoal === 'B' ? bot.patrolB : bot.patrolA) : null;
      if (goal != null) {
        if (!bot.path.length) setPath(bot, map, goal);
        if (moveAlongPath(bot, map, dt)) {
          bot.patrolGoal = bot.patrolGoal === 'B' ? 'A' : 'B';
          bot.path = [];
        }
      } else if (bot.followPlayer) {
        // Teammates shadow the player at a distance.
        const node = nearestWaypoint(map.waypoints, state.player.pos.x, state.player.pos.z);
        const d = Math.hypot(bot.pos.x - state.player.pos.x, bot.pos.z - state.player.pos.z);
        if (d > 7) {
          if (!bot.path.length) setPath(bot, map, node);
          moveAlongPath(bot, map, dt);
        } else {
          bot.yaw = state.player.yaw;
        }
      }
    } else if (bot.state === 'hold' && bot.holdNode != null) {
      // Drift to the hold node, then scan (slow yaw sweep).
      const wp = map.waypoints[bot.holdNode];
      const d = Math.hypot(wp.x - bot.pos.x, wp.z - bot.pos.z);
      if (d > 0.8) {
        if (!bot.path.length) setPath(bot, map, bot.holdNode);
        moveAlongPath(bot, map, dt);
      } else {
        bot.yaw += Math.sin(state.time * 0.5 + bot.id * 2) * dt * 0.4;
      }
    }
    // Write the pose to the mesh.
    bot.group.position.set(bot.pos.x, 0, bot.pos.z);
    bot.group.rotation.y = bot.yaw;
    if (!bot.alive) continue;
    // Simple walk bob.
    const moving = bot.state === 'patrol' || bot.state === 'investigate' || bot.state === 'plant' || bot.state === 'defuse';
    bot.group.position.y = moving ? Math.abs(Math.sin(state.time * 9 + bot.id)) * 0.03 : 0;
  }
}

export function killBot(state, bot, killerName) {
  if (!bot.alive) return;
  bot.alive = false;
  bot.hp = 0;
  bot.deadT = 0;
  bot.group.rotation.x = -Math.PI / 2 + 0.12;
  bot.group.position.y = 0.25;
  return killerName;
}

export function respawnBots(state, map) {
  nextId = 0;
  let vi = 0;
  let si = 0;
  for (const bot of state.bots) {
    const spawn = bot.team === 0
      ? map.spawns.vanguard[vi++ % map.spawns.vanguard.length]
      : map.spawns.sentinel[si++ % map.spawns.sentinel.length];
    bot.pos.x = spawn.x;
    bot.pos.z = spawn.z;
    bot.hp = 100;
    bot.alive = true;
    bot.yaw = bot.team === 0 ? Math.PI / 2 : -Math.PI / 2;
    bot.state = bot.team === 1 && bot.holdNode != null ? 'hold' : 'patrol';
    bot.path = [];
    bot.target = null;
    bot.planting = 0;
    bot.defusing = 0;
    bot.siteGoal = null;
    bot.group.rotation.x = 0;
    bot.group.position.set(spawn.x, 0, spawn.z);
    bot.group.rotation.y = bot.yaw;
  }
}
