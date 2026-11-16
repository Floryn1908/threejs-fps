// audio.js — one job: all sound, synthesised with WebAudio. No audio files.
// One shared noise buffer and one master gain; every effect is a few nodes.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this._noise = null;
    this.muted = false;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this._noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this._noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }
  _burst(dur, filterFreq, gain, type = 'lowpass') {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }
  _tone(freq, dur, gain, type = 'sine', slideTo = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur);
  }
  shot(kind) {
    if (kind === 'sniper') {
      this._burst(0.28, 900, 0.9);
      this._tone(140, 0.18, 0.5, 'sawtooth', 50);
    } else if (kind === 'smg') {
      this._burst(0.09, 2200, 0.5);
    } else if (kind === 'pistol') {
      this._burst(0.12, 1600, 0.6);
    } else {
      this._burst(0.16, 1200, 0.8);
      this._tone(110, 0.1, 0.35, 'square', 60);
    }
  }
  enemyShot(dist) {
    const g = Math.max(0.08, 0.5 - dist * 0.012);
    this._burst(0.14, 900, g);
  }
  dryFire() {
    this._tone(1400, 0.05, 0.25, 'square');
  }
  hit() {
    this._tone(2100, 0.06, 0.35, 'square');
  }
  kill() {
    this._tone(880, 0.09, 0.4, 'sine');
    setTimeout(() => this._tone(1320, 0.12, 0.4, 'sine'), 70);
  }
  reload() {
    this._tone(500, 0.05, 0.3, 'square');
    setTimeout(() => this._tone(700, 0.05, 0.3, 'square'), 220);
  }
  hurt() {
    this._tone(90, 0.18, 0.5, 'sawtooth', 55);
  }
  step() {
    this._burst(0.05, 400, 0.12);
  }
  beep() {
    this._tone(1250, 0.09, 0.35, 'sine');
  }
  plant() {
    this._tone(980, 0.1, 0.4, 'sine');
    setTimeout(() => this._tone(980, 0.1, 0.4, 'sine'), 140);
  }
  explosion() {
    this._burst(1.1, 300, 1.0);
    this._tone(55, 0.9, 0.8, 'sine', 30);
  }
  roundWin() {
    [523, 659, 784].forEach((f, i) => setTimeout(() => this._tone(f, 0.16, 0.4, 'sine'), i * 110));
  }
  roundLose() {
    [392, 330, 262].forEach((f, i) => setTimeout(() => this._tone(f, 0.18, 0.4, 'sine'), i * 120));
  }
  buy() {
    this._tone(660, 0.07, 0.35, 'sine');
    setTimeout(() => this._tone(990, 0.1, 0.35, 'sine'), 80);
  }
}
