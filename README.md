[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Floryn1908/threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Floryn1908/threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02)

# Emberline — Foundry Yard

A complete round-based tactical FPS in three.js. One player plus two bot teammates
(Vanguard) attack two bomb sites against four bots (Sentinels) that hold positions,
patrol, hear gunfire and defuse. First to 5 rounds wins the match.

- **Complete game** — first-person mouse-look + WASD, a weapon that fires, reloads
  and runs out of ammo, bots that move, see and shoot back, rounds that end in
  win/loss and restart, HUD with health, ammo, round timer and score.
- **Gunplay** — headshot hitboxes (head ×2–2.5), recoil and spread that punish
  firing on the move, acceleration, crouching, collision with the map.
- **Tactics** — bomb plant (hold E, 3s) and defuse (5s), money per round spent in
  a buy menu (B), rifle / SMG / sniper / pistol / frag grenade, bots that follow
  routes, hold sites and react to sight and sound.
- **Map** — original dusk industrial yard: Long lane, Yard lane, mid corridor,
  Foundry (A) and Depot (B) sites, crates, barrels and containers for cover.
- **Code** — one-job modules, fixed 60 Hz simulation apart from rendering,
  pooled tracers, no allocations in hot loops, state in one store.

## Run it

Serve the `game/` folder with any static server and open `index.html`:

```sh
cd game && python3 -m http.server 8080
# open http://localhost:8080/
```

Click to play. Controls: **WASD** move, **mouse** aim, **click** fire, **R** reload,
**Ctrl** crouch, **Space** jump, **G** grenade, **B** buy menu, **E** (hold) plant
the bomb, **1–4** switch weapon, **M** mute.

## Build the dossier

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts
```

Copies `game/` and `screenshots/` to `out/` and writes `out/dossier.json`.

---

Built for the [threejs-fps-02 bounty](https://make.fun/bounty/threejs-fps-02) — [make.fun](https://make.fun/?ref=x054zwkw)
