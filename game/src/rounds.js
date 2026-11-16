// rounds.js — one job: round flow, economy, the bomb objective and win/loss.
// Phases: buy (12s) -> live (100s) -> over (4s) -> next round or match end.
// Attackers (Vanguard) win by elimination or bomb explosion; defenders (Sentinels)
// win by elimination, defuse or time.
import { pushFeed, pushEvent, TEAM } from './state.js';
import { WEAPONS, buyWeapon, buyGrenade, buyAmmo } from './weapons.js';
import { killBot } from './bots.js';

export const BUY_TIME = 12;
export const ROUND_TIME = 100;
export const BOMB_FUSE = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;

export function startMatch(state) {
  state.score = [0, 0];
  state.kills = [0, 0];
  state.round = 1;
  state.matchWinner = -1;
  state.money = [800, 0];
  startRound(state);
}

export function startRound(state) {
  state.phase = 'buy';
  state.phaseT = 0;
  state.timer = BUY_TIME;
  state.roundWinner = -1;
  state.roundReason = '';
  state.bomb = {
    state: 'carried', carrier: 'player',
    pos: { x: 0, y: 0, z: 0 }, site: null, fuse: 0, defuse: 0,
  };
  const p = state.player;
  p.hp = 100;
  p.alive = true;
  p.pos.x = -27;
  p.pos.z = 0;
  p.pos.y = 0;
  p.yaw = -Math.PI / 2; // Face east, down mid toward the sites.
  p.pitch = 0;
  p.vel.x = 0;
  p.vel.z = 0;
  p.hasBomb = true;
  p.planting = 0;
  p.defusing = 0;
  p.reloadT = 0;
  p.fireT = 0;
  if (!p.weapons.rifle && !p.weapons.smg && !p.weapons.sniper) {
    p.weapon = 'pistol';
  }
  pushFeed(state, `Round ${state.round} — buy phase (B to shop)`);
}

function aliveCount(state, team) {
  let n = 0;
  if (team === 0 && state.player.alive) n++;
  for (const b of state.bots) if (b.alive && b.team === team) n++;
  return n;
}

export function endRound(state, winner, reason) {
  if (state.phase === 'over') return;
  state.phase = 'over';
  state.phaseT = 0;
  state.roundWinner = winner;
  state.roundReason = reason;
  state.score[winner]++;
  const winMoney = winner === TEAM.VANGUARD ? 3250 : 3250;
  const loseMoney = 1900;
  if (winner === TEAM.VANGUARD) {
    state.money[0] += winMoney;
    pushEvent(state, 'roundEnd', { winner, win: true });
  } else {
    state.money[0] += loseMoney;
    pushEvent(state, 'roundEnd', { winner, win: false });
  }
  pushFeed(state, `${winner === 0 ? 'Vanguard' : 'Sentinels'} take round ${state.round} — ${reason}`);
}

export function stepRounds(state, map, hooks, dt) {
  state.phaseT += dt;
  if (state.phase === 'buy') {
    state.timer = Math.max(0, BUY_TIME - state.phaseT);
    if (state.phaseT >= BUY_TIME) {
      state.phase = 'live';
      state.phaseT = 0;
      state.timer = ROUND_TIME;
      pushFeed(state, 'Round live — plant the bomb at Foundry (A) or Depot (B)');
    }
    return;
  }
  if (state.phase === 'over') {
    if (state.phaseT >= 4) {
      if (state.score[0] >= state.roundsToWin || state.score[1] >= state.roundsToWin) {
        state.phase = 'match';
        state.matchWinner = state.score[0] > state.score[1] ? 0 : 1;
        pushEvent(state, 'matchEnd', { winner: state.matchWinner });
      } else {
        state.round++;
        hooks.respawn(state, map);
        startRound(state);
      }
    }
    return;
  }
  if (state.phase !== 'live') return;

  // Timers.
  if (state.bomb.state === 'planted') {
    state.bomb.fuse -= dt;
    state.timer = Math.max(0, state.bomb.fuse);
    if (state.bomb.fuse <= 0) {
      hooks.explosion(state.bomb.pos);
      endRound(state, TEAM.VANGUARD, 'bomb detonated at ' + state.bomb.site);
      return;
    }
  } else {
    state.timer = Math.max(0, ROUND_TIME - state.phaseT);
    if (state.timer <= 0) {
      endRound(state, TEAM.SENTINEL, 'time expired — bomb never planted');
      return;
    }
  }
  // Elimination.
  const vAlive = aliveCount(state, 0);
  const sAlive = aliveCount(state, 1);
  if (vAlive === 0) {
    endRound(state, TEAM.SENTINEL, 'Vanguard eliminated');
    return;
  }
  if (sAlive === 0) {
    endRound(state, TEAM.VANGUARD, 'Sentinels eliminated');
    return;
  }
  // Bomb carrier died: drop it; a Vanguard bot picks it up and plants.
  if (state.bomb.state === 'carried' && state.bomb.carrier === 'player' && !state.player.alive) {
    state.bomb.state = 'dropped';
    state.bomb.carrier = null;
    state.bomb.pos = { x: state.player.pos.x, y: 0, z: state.player.pos.z };
    pushFeed(state, 'Bomb dropped');
  }
  if (state.bomb.state === 'dropped') {
    for (const b of state.bots) {
      if (!b.alive || b.team !== 0) continue;
      if (Math.hypot(b.pos.x - state.bomb.pos.x, b.pos.z - state.bomb.pos.z) < 1.2) {
        state.bomb.state = 'carried';
        state.bomb.carrier = b.id;
        b.state = 'plant';
        b.siteGoal = null;
        pushFeed(state, `${b.name} picked up the bomb`);
        break;
      }
    }
    if (state.player.alive && Math.hypot(state.player.pos.x - state.bomb.pos.x, state.player.pos.z - state.bomb.pos.z) < 1.2) {
      state.bomb.state = 'carried';
      state.bomb.carrier = 'player';
      state.player.hasBomb = true;
      pushFeed(state, 'Bomb recovered');
    }
  }
  // Planting (player holds E near a site).
  const p = state.player;
  if (p.alive && state.bomb.state === 'carried' && state.bomb.carrier === 'player') {
    const site = nearSite(state, map, p.pos.x, p.pos.z);
    if (site && p.wantPlant) {
      p.planting += dt;
      hooks.playerPlanting(p.planting / PLANT_TIME);
      if (p.planting >= PLANT_TIME) {
        p.planting = 0;
        state.bomb.state = 'planted';
        state.bomb.site = site;
        state.bomb.fuse = BOMB_FUSE;
        state.bomb.pos = { x: p.pos.x, y: 0, z: p.pos.z };
        state.money[0] += 300;
        pushFeed(state, `Bomb planted at ${site === 'A' ? 'Foundry' : 'Depot'} — 35s fuse`);
        pushEvent(state, 'planted', { site });
        // Sentinels converge to defuse.
        for (const b of state.bots) {
          if (b.alive && b.team === 1) {
            b.state = 'defuse';
            b.defusing = 0;
            b.path = [];
          }
        }
      }
    } else {
      p.planting = 0;
    }
  }
  // Defuse progress is driven by bots.js hooks (botDefused).
}

export function nearSite(state, map, x, z) {
  for (const key of ['A', 'B']) {
    const s = map.sites[key];
    if (Math.hypot(x - s.center.x, z - s.center.z) < s.r) return key;
  }
  return null;
}

export function onBotKilled(state, bot, killer) {
  // killer: 'player' or a bot ref.
  const killerTeam = killer === 'player' ? 0 : killer.team;
  state.kills[killerTeam]++;
  if (killer === 'player') {
    state.money[0] += 300;
    pushFeed(state, `You eliminated ${bot.name} (+$300)`);
  } else {
    pushFeed(state, `${killer.name} eliminated ${bot.name}`);
  }
  if (killer === 'player') pushEvent(state, 'kill', { name: bot.name });
  // If the carrier died, the bomb drops (handled in stepRounds next tick).
  if (state.bomb.state === 'carried' && state.bomb.carrier === bot.id) {
    state.bomb.state = 'dropped';
    state.bomb.carrier = null;
    state.bomb.pos = { x: bot.pos.x, y: 0, z: bot.pos.z };
  }
  killBot(state, bot, killer === 'player' ? 'you' : killer.name);
}

export function onPlayerKilled(state, byName) {
  pushFeed(state, `${byName} eliminated you`);
  pushEvent(state, 'death', { by: byName });
}

export function applyBuy(state, key, audio) {
  if (state.phase !== 'buy') return false;
  let ok = false;
  if (key === '1') ok = buyWeapon(state, 'rifle');
  else if (key === '2') ok = buyWeapon(state, 'smg');
  else if (key === '3') ok = buyWeapon(state, 'sniper');
  else if (key === '4') ok = buyGrenade(state);
  else if (key === '5') ok = buyAmmo(state);
  if (ok) audio.buy();
  return ok;
}

export function weaponList(state) {
  const p = state.player;
  return Object.keys(WEAPONS).map((k) => ({
    key: k,
    name: WEAPONS[k].name,
    price: WEAPONS[k].price,
    owned: !!p.weapons[k],
    current: p.weapon === k,
  }));
}
