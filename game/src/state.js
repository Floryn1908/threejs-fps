// state.js — one job: the single store every module reads and writes.
// No module keeps its own copy of match state; the fixed-step simulation owns it.
export const TEAM = { VANGUARD: 0, SENTINEL: 1 };

export function createState() {
  return {
    // Match flow: 'menu' | 'buy' | 'live' | 'over' | 'match'
    phase: 'menu',
    phaseT: 0,
    round: 1,
    roundsToWin: 5,
    score: [0, 0], // [vanguard, sentinel] rounds won
    kills: [0, 0],
    timer: 0,
    roundWinner: -1,
    roundReason: '',
    matchWinner: -1,
    money: [800, 0], // player money; bots share a simple pool each round
    // Player
    player: {
      pos: { x: -26, y: 0, z: 0 },
      vel: { x: 0, z: 0 },
      yaw: Math.PI / 2, // facing +x (east, toward mid)
      pitch: 0,
      hp: 100,
      alive: true,
      crouch: false,
      onGround: true,
      vy: 0,
      weapon: 'rifle',
      weapons: { pistol: { mag: 12, reserve: 48 } },
      grenades: 0,
      hasBomb: true,
      recoil: 0,
      bloom: 0,
      fireT: 0,
      reloadT: 0,
      reloadTotal: 0,
      planting: 0,
      defusing: 0,
      hurtT: 0,
      stepT: 0,
    },
    bots: [], // {id, team, kind, pos, yaw, hp, alive, state, ...}
    grenades: [], // live grenades {pos, vel, fuse, team}
    bomb: {
      state: 'carried', // carried | dropped | planted | gone
      carrier: 'player', // 'player' | bot id | null
      pos: { x: 0, y: 0, z: 0 },
      site: null, // 'A' | 'B'
      fuse: 0,
      defuse: 0,
    },
    feed: [], // {text, t}
    events: [], // one-frame flags consumed by HUD/audio: {type, ...}
    time: 0,
    shot: null, // screenshot staging: 'combat' | 'site' | 'buy' | 'cover' | null
  };
}

export function pushFeed(state, text) {
  state.feed.push({ text, t: state.time });
  if (state.feed.length > 6) state.feed.shift();
}
export function pushEvent(state, type, data) {
  state.events.push({ type, ...(data || {}) });
}
