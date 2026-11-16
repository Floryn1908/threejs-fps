// palette.js — one job: every colour and material the game uses.
// Dusk industrial palette for "Foundry Yard": cold slate blue-grey structures,
// warm amber work lights, rust-orange site markers. Six base colours only.
import * as THREE from 'three';

export const PALETTE = {
  sky: 0x1b2230,
  fog: 0x232b38,
  floor: 0x33383f,
  floorLine: 0x2a2f35,
  wall: 0x4b5158,
  wallDark: 0x383d44,
  crate: 0x6b5a3e,
  crateDark: 0x54452f,
  barrel: 0x7a3b22,
  amber: 0xf0a830,
  amberDim: 0x8a6420,
  siteA: 0xe86a1e,
  siteB: 0x2fa8a0,
  vanguard: 0xf0a830,
  sentinel: 0xd43a2e,
  tracer: 0xffd27a,
  white: 0xe9e6df,
};

const cache = new Map();
export function mat(color, rough = 0.9, metal = 0.0) {
  const key = color + '|' + rough + '|' + metal;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    cache.set(key, m);
  }
  return m;
}
export function emissiveMat(color, intensity = 1.0) {
  const key = 'e' + color + '|' + intensity;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: 0x111111,
      emissive: color,
      emissiveIntensity: intensity,
      roughness: 0.6,
    });
    cache.set(key, m);
  }
  return m;
}
