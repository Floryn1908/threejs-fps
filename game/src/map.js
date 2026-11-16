// map.js — one job: the original "Foundry Yard" map.
// Two lanes (Long north, Yard south), a mid corridor, bomb sites Foundry (A, north-east)
// and Depot (B, south-east), crates and walls for cover. Everything is an AABB collider;
// bots walk a waypoint graph built from the same layout.
import * as THREE from 'three';
import { mat, emissiveMat, PALETTE } from './palette.js';

// Walls and crates: [cx, cz, w, d, h]. The map is x in [-30, 30], z in [-20, 20].
const WALLS = [
  // Perimeter
  [0, -20.5, 62, 1, 4], [0, 20.5, 62, 1, 4],
  [-30.5, 0, 1, 42, 4], [30.5, 0, 1, 42, 4],
  // Lane dividers (z = -10 and z = +10), with connector gaps at x = 8..12
  [-8, -10, 32, 1, 3.2], [19, -10, 14, 1, 3.2],
  [-8, 10, 32, 1, 3.2], [19, 10, 14, 1, 3.2],
  // Mid door wall at x = 2 (gap z = -1.2..1.2)
  [2, -6.2, 1, 7.6, 3.2], [2, 6.2, 1, 7.6, 3.2],
  // Site A pocket walls
  [14, -14, 1, 8, 3.2], [24, -8.5, 9, 1, 3.2],
  // Site B pocket walls
  [14, 14, 1, 8, 3.2], [24, 8.5, 9, 1, 3.2],
  // Courtyard blocks
  [-8, -4, 4, 1, 2.2], [-8, 4, 4, 1, 2.2],
  [8, -4, 1, 4, 2.2], [8, 4, 1, 4, 2.2],
];
const CRATES = [
  // [cx, cz, size, stacked]
  [-16, -5, 1.2, 0], [-16, 5, 1.2, 0], [-4, -6, 1.2, 1], [4, 6, 1.2, 0],
  [12, -3, 1.2, 0], [12, 3, 1.2, 1], [18, -6, 1.2, 0], [18, 6, 1.2, 0],
  [22, -13, 1.2, 1], [17, -16, 1.2, 0], [22, 13, 1.2, 0], [17, 16, 1.2, 1],
  [-22, -14, 1.2, 0], [-22, 14, 1.2, 0], [-12, -14, 1.2, 1], [-12, 14, 1.2, 0],
  [26, 0, 1.2, 1], [-26, -6, 1.2, 0], [-26, 6, 1.2, 0],
];
const BARRELS = [
  [6, -8], [6, 8], [-20, 0], [24, -16], [24, 16], [10, -14], [10, 14],
];

export const SITES = {
  A: { name: 'Foundry', center: { x: 21, z: -13 }, r: 4.5, color: PALETTE.siteA },
  B: { name: 'Depot', center: { x: 21, z: 13 }, r: 4.5, color: PALETTE.siteB },
};
export const SPAWNS = {
  vanguard: [
    { x: -27, z: -3 }, { x: -27, z: 0 }, { x: -27, z: 3 },
  ],
  sentinel: [
    { x: 27, z: -3 }, { x: 27, z: 0 }, { x: 27, z: 3 }, { x: 24, z: -8 }, { x: 24, z: 8 },
  ],
};

// Waypoint graph: nodes with neighbours, by index.
const WP = [
  [-27, 0], [-20, 0], [-12, 0], [-4, 0], [2, 0], [10, 0], [18, 0], [25, 0],
  [-24, -14], [-14, -14], [-4, -14], [6, -14], [14, -14], [21, -13],
  [-24, 14], [-14, 14], [-4, 14], [6, 14], [14, 14], [21, 13],
  [10, -6], [10, 6], [-4, -6], [4, 6], [-12, -6], [-12, 6],
];
const LINKS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7],
  [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
  [14, 15], [15, 16], [16, 17], [17, 18], [18, 19],
  [1, 8], [1, 14], [3, 22], [3, 24], [5, 20], [5, 21],
  [11, 20], [17, 21], [2, 9], [2, 15], [10, 22], [16, 23],
  [6, 12], [6, 18], [22, 23], [24, 25], [20, 12], [21, 18],
];

function aabb(cx, cz, w, d, h) {
  return { minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, h };
}

export function buildMap(scene) {
  const colliders = [];
  const group = new THREE.Group();
  group.name = 'map';

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(62, 42), mat(PALETTE.floor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, 0);
  floor.receiveShadow = false;
  group.add(floor);
  // Lane guide strips (amber, flush with the floor)
  const stripGeo = new THREE.PlaneGeometry(1, 0.18);
  const stripMat = emissiveMat(PALETTE.amberDim, 0.7);
  for (const [x, z, w] of [[-14, -14, 20], [-14, 14, 20], [-14, 0, 24], [18, -13, 8], [18, 13, 8]]) {
    const s = new THREE.Mesh(stripGeo, stripMat);
    s.rotation.x = -Math.PI / 2;
    s.scale.x = w;
    s.position.set(x, 0.02, z);
    group.add(s);
  }

  const wallGeo = new THREE.BoxGeometry(1, 1, 1);
  for (const [cx, cz, w, d, h] of WALLS) {
    const m = new THREE.Mesh(wallGeo, mat(PALETTE.wall));
    m.scale.set(w, h, d);
    m.position.set(cx, h / 2, cz);
    group.add(m);
    // Amber cap on the two mid-door walls so the gap reads at a glance.
    if (cx === 2) {
      const cap = new THREE.Mesh(wallGeo, emissiveMat(PALETTE.amber, 1.2));
      cap.scale.set(1.1, 0.12, d);
      cap.position.set(cx, h + 0.06, cz);
      group.add(cap);
    }
    colliders.push(aabb(cx, cz, w, d, h));
  }
  for (const [cx, cz, s, stacked] of CRATES) {
    const m = new THREE.Mesh(wallGeo, mat(stacked ? PALETTE.crateDark : PALETTE.crate));
    m.scale.set(s, s, s);
    m.position.set(cx, s / 2, cz);
    group.add(m);
    colliders.push(aabb(cx, cz, s, s, s));
    if (stacked) {
      const top = new THREE.Mesh(wallGeo, mat(PALETTE.crate));
      top.scale.set(s * 0.8, s * 0.8, s * 0.8);
      top.position.set(cx, s + s * 0.4, cz);
      group.add(top);
      colliders.push(aabb(cx, cz, s * 0.8, s * 0.8, s * 1.8));
    }
  }
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 12);
  for (const [cx, cz] of BARRELS) {
    const b = new THREE.Mesh(barrelGeo, mat(PALETTE.barrel, 0.7, 0.3));
    b.position.set(cx, 0.55, cz);
    group.add(b);
    colliders.push(aabb(cx, cz, 1.1, 1.1, 1.1));
  }

  // Site markers: glowing rings + beacons.
  const siteMeshes = {};
  for (const key of ['A', 'B']) {
    const site = SITES[key];
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.r - 0.35, site.r, 40),
      emissiveMat(site.color, 1.6),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.04, site.center.z);
    group.add(ring);
    const beacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 2.6, 0.5),
      emissiveMat(site.color, 2.0),
    );
    beacon.position.set(site.center.x, 1.3, site.center.z);
    group.add(beacon);
    siteMeshes[key] = { ring, beacon };
  }
  // Furnace at site A, containers at site B.
  const furnace = new THREE.Mesh(wallGeo, mat(PALETTE.wallDark));
  furnace.scale.set(4, 3, 1.5);
  furnace.position.set(27, 1.5, -17);
  group.add(furnace);
  colliders.push(aabb(27, -17, 4, 1.5, 3));
  const glow = new THREE.Mesh(wallGeo, emissiveMat(PALETTE.siteA, 2.2));
  glow.scale.set(3, 1, 0.2);
  glow.position.set(27, 1.0, -16.2);
  group.add(glow);
  const cont = new THREE.Mesh(wallGeo, mat(0x2f5f5a));
  cont.scale.set(4, 2.4, 2);
  cont.position.set(27, 1.2, 17);
  group.add(cont);
  colliders.push(aabb(27, 17, 4, 2, 2.4));

  // Distant skyline silhouettes outside the walls.
  const skyGeo = new THREE.BoxGeometry(1, 1, 1);
  const skyMat = mat(0x141a24);
  const skyline = [[-40, -28, 8, 14], [-15, -32, 10, 20], [15, -30, 7, 11], [38, -26, 9, 16], [-38, 28, 9, 12], [5, 30, 12, 18], [36, 26, 8, 13]];
  for (const [x, z, w, h] of skyline) {
    const b = new THREE.Mesh(skyGeo, skyMat);
    b.scale.set(w, h, w);
    b.position.set(x, h / 2, z);
    group.add(b);
  }
  scene.add(group);

  const waypoints = WP.map(([x, z]) => ({ x, z }));
  const adj = waypoints.map(() => []);
  for (const [a, b] of LINKS) {
    adj[a].push(b);
    adj[b].push(a);
  }
  return { colliders, waypoints, adj, sites: SITES, spawns: SPAWNS, siteMeshes };
}

// Circle (x, z, r) vs AABB colliders: push the circle out. Mutates pos.
export function collideCircle(colliders, pos, r) {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    const nx = Math.max(c.minX, Math.min(pos.x, c.maxX));
    const nz = Math.max(c.minZ, Math.min(pos.z, c.maxZ));
    const dx = pos.x - nx;
    const dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        pos.x = nx + (dx / d) * r;
        pos.z = nz + (dz / d) * r;
      } else {
        // Centre inside the box: push out along the smallest penetration axis.
        const pl = pos.x - c.minX;
        const pr = c.maxX - pos.x;
        const pt = pos.z - c.minZ;
        const pb = c.maxZ - pos.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) pos.x = c.minX - r;
        else if (m === pr) pos.x = c.maxX + r;
        else if (m === pt) pos.z = c.minZ - r;
        else pos.z = c.maxZ + r;
      }
    }
  }
  pos.x = Math.max(-29.4, Math.min(29.4, pos.x));
  pos.z = Math.max(-19.4, Math.min(19.4, pos.z));
}

// 3D segment vs AABB (walls block sight only below their height).
export function segmentBlocked(colliders, ax, ay, az, bx, by, bz) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    let t0 = 0;
    let t1 = 1;
    // X slab
    if (Math.abs(dx) < 1e-9) {
      if (ax < c.minX || ax > c.maxX) continue;
    } else {
      let ta = (c.minX - ax) / dx;
      let tb = (c.maxX - ax) / dx;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Y slab (box spans y 0..h)
    if (Math.abs(dy) < 1e-9) {
      if (ay < 0 || ay > c.h) continue;
    } else {
      let ta = (0 - ay) / dy;
      let tb = (c.h - ay) / dy;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    // Z slab
    if (Math.abs(dz) < 1e-9) {
      if (az < c.minZ || az > c.maxZ) continue;
    } else {
      let ta = (c.minZ - az) / dz;
      let tb = (c.maxZ - az) / dz;
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
      if (t0 > t1) continue;
    }
    return true;
  }
  return false;
}

export function hasLOS(colliders, ax, ay, az, bx, by, bz) {
  return !segmentBlocked(colliders, ax, ay, az, bx, by, bz);
}

// BFS over the waypoint graph; returns an array of node indices from start to goal.
export function findPath(adj, start, goal) {
  if (start === goal) return [start];
  const prev = new Int16Array(adj.length).fill(-1);
  const q = [start];
  prev[start] = start;
  for (let h = 0; h < q.length; h++) {
    const n = q[h];
    for (const m of adj[n]) {
      if (prev[m] === -1) {
        prev[m] = n;
        if (m === goal) {
          const path = [goal];
          let cur = goal;
          while (cur !== start) {
            cur = prev[cur];
            path.push(cur);
          }
          path.reverse();
          return path;
        }
        q.push(m);
      }
    }
  }
  return [start];
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}
