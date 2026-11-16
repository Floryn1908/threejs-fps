// input.js — one job: keyboard, mouse and pointer lock state.
// Poll-based: the simulation reads a snapshot each fixed step, so input never
// allocates and never fires game logic directly.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.mouseDown = false;
    this.mouseDownEdge = false;
    this.fireEdge = false;
    this.rightDown = false;
    this.locked = false;
    this._onKeyDown = (e) => {
      if (e.code === 'Space') e.preventDefault();
      this.keys.add(e.code);
      this._presses.add(e.code);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    };
    this._onMouseDown = (e) => {
      if (!this.locked) return;
      if (e.button === 0) {
        if (!this.mouseDown) this.mouseDownEdge = true;
        this.mouseDown = true;
        this.fireEdge = true;
      }
      if (e.button === 2) this.rightDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    };
    this._onLockChange = () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        this.mouseDown = false;
        this.rightDown = false;
      }
    };
    this._onContextMenu = (e) => e.preventDefault();
    this._presses = new Set();
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('contextmenu', this._onContextMenu);
    document.addEventListener('pointerlockchange', this._onLockChange);
  }
  requestLock() {
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      // Headless or denied: the game still runs (screenshot mode never locks).
    }
  }
  exitLock() {
    try {
      document.exitPointerLock();
    } catch {
      /* already unlocked */
    }
  }
  down(code) {
    return this.keys.has(code);
  }
  // True once for the step after the key went down, then consumed.
  pressed(code) {
    if (this._presses.has(code)) {
      this._presses.delete(code);
      return true;
    }
    return false;
  }
  // True once after a left click, for semi-auto weapons. Read and cleared by the game.
  takeFireEdge() {
    const e = this.fireEdge;
    this.fireEdge = false;
    return e;
  }
  consumeMouse() {
    const dx = this.mouseDX;
    const dy = this.mouseDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    const edge = this.mouseDownEdge;
    this.mouseDownEdge = false;
    return { dx, dy, edge };
  }
  endStep() {
    this._presses.clear();
  }
}
