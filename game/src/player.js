// player.js — one job: the human player's movement, look, collision and health.
// Acceleration-based movement with crouch and jump; collision is a circle vs the
// map's AABBs, resolved per axis so the player slides along walls.
import { collideCircle } from './map.js';

const EYE_STAND = 1.62;
const EYE_CROUCH = 1.05;
const RADIUS = 0.42;
const WALK_SPEED = 5.4;
const CROUCH_SPEED = 2.6;
const ACCEL = 42;
const FRICTION = 10;

export function eyeHeight(p) {
  return p.crouch ? EYE_CROUCH : EYE_STAND;
}

export function stepPlayer(state, map, input, dt) {
  const p = state.player;
  if (!p.alive) return;
  // Look (mouse deltas are consumed once per step).
  const m = input.consumeMouse();
  p.yaw -= m.dx * 0.0021;
  p.pitch -= m.dy * 0.0021;
  p.pitch = Math.max(-1.5, Math.min(1.5, p.pitch));
  // Recoil decays back toward zero; bloom decays too.
  p.recoil = Math.max(0, p.recoil - dt * 0.16);
  p.bloom = Math.max(0, p.bloom - dt * 0.045);
  p.pitch += p.recoil * dt * 2.2;
  if (p.fireT > 0) p.fireT -= dt;
  if (p.reloadT > 0) {
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      p.reloadT = 0;
      // Reload completion is applied by rounds.js via finishReload.
      p.reloadDone = true;
    }
  }
  if (p.hurtT > 0) p.hurtT -= dt;

  const wantCrouch = input.down('ControlLeft') || input.down('ControlRight');
  p.crouch = wantCrouch;
  const speed = wantCrouch ? CROUCH_SPEED : WALK_SPEED;
  let fx = 0;
  let fz = 0;
  if (input.down('KeyW')) fz += 1;
  if (input.down('KeyS')) fz -= 1;
  if (input.down('KeyA')) fx -= 1;
  if (input.down('KeyD')) fx += 1;
  const len = Math.hypot(fx, fz);
  if (len > 0) {
    fx /= len;
    fz /= len;
  }
  const sin = Math.sin(p.yaw);
  const cos = Math.cos(p.yaw);
  // Forward is -z rotated by yaw; right is +x rotated by yaw.
  const wx = -sin * fz + cos * fx;
  const wz = -cos * fz - sin * fx;
  p.vel.x += wx * ACCEL * dt;
  p.vel.z += wz * ACCEL * dt;
  // Friction when no input; clamp to top speed.
  const sp = Math.hypot(p.vel.x, p.vel.z);
  if (len === 0 && sp > 0) {
    const dec = Math.max(0, sp - FRICTION * sp * dt);
    p.vel.x *= dec / sp;
    p.vel.z *= dec / sp;
  }
  const max = speed;
  const sp2 = Math.hypot(p.vel.x, p.vel.z);
  if (sp2 > max) {
    p.vel.x *= max / sp2;
    p.vel.z *= max / sp2;
  }
  // Jump / gravity.
  if (input.pressed('Space') && p.onGround && !p.crouch) {
    p.vy = 5.2;
    p.onGround = false;
  }
  if (!p.onGround) {
    p.vy -= 16 * dt;
    p.pos.y += p.vy * dt;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vy = 0;
      p.onGround = true;
    }
  }
  p.pos.x += p.vel.x * dt;
  p.pos.z += p.vel.z * dt;
  collideCircle(map.colliders, p.pos, RADIUS);
  // Footstep ticks while moving on the ground.
  if (sp2 > 1.5 && p.onGround) {
    p.stepT -= dt * sp2;
    if (p.stepT <= 0) {
      p.stepT = 2.2;
      p.stepped = true;
    }
  }
}

export function damagePlayer(state, dmg, fromName) {
  const p = state.player;
  if (!p.alive) return;
  p.hp -= dmg;
  p.hurtT = 0.35;
  if (p.hp <= 0) {
    p.hp = 0;
    p.alive = false;
    p.deathBy = fromName;
  }
}
