// Dub worklets.
// dub-rec: copies its input to the main thread while recording (for Rec Out).
class Rec extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.port.onmessage = ({ data }) => { this.on = !!data.on; if (!this.on) this.port.postMessage({ done: true }); };
  }
  process(inputs) {
    if (this.on) {
      const inp = inputs[0];
      const l = inp[0] ? inp[0].slice() : new Float32Array(128), r = inp[1] ? inp[1].slice() : l.slice();
      this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
    }
    return true;
  }
}
registerProcessor('dub-rec', Rec);

// dub-take: records the frames [at, at + len) of its input (AudioContext clock), then sends { l, r } once.
//   port.postMessage({ at, len }) to arm, ({ stop: true }) to end it (sends what it has), ({ cancel: true }) to drop it.
//   While recording it sends { pk, at } every 2048 frames (the loudest sample) for the picture.
class Take extends AudioWorkletProcessor {
  constructor() {
    super();
    this.job = null;
    this.port.onmessage = ({ data }) => {
      if (data.cancel) this.job = null;
      else if (data.stop) { if (this.job) { this.send(this.job); this.job = null; } } // stopped: what was recorded so far
      else this.job = { at: data.at, len: data.len, cl: [], cr: [], got: 0, pk: 0 }; // filled in 1 s blocks as it goes (no 2-minute buffer up front)
    };
  }
  send(j) { // the blocks joined into one take of the length recorded
    const l = new Float32Array(j.got), r = new Float32Array(j.got), B = sampleRate;
    j.cl.forEach((c, k) => { const m = Math.min(B, j.got - k * B); if (m > 0) { l.set(c.subarray(0, m), k * B); r.set(j.cr[k].subarray(0, m), k * B); } });
    this.port.postMessage({ l, r }, [l.buffer, r.buffer]);
  }
  process(inputs) {
    const j = this.job; if (!j) return true;
    const inp = inputs[0] || [], L = inp[0], R = inp[1] || inp[0], n = L ? L.length : 128, f0 = currentFrame;
    for (let i = 0; i < n; i++) {
      const k = f0 + i - j.at; if (k < 0 || k >= j.len) continue;
      const a = L ? L[i] : 0, b = R ? R[i] : 0, B = sampleRate, c = (k / B) | 0;
      if (c >= j.cl.length) { j.cl.push(new Float32Array(B)); j.cr.push(new Float32Array(B)); }
      j.cl[c][k - c * B] = a; j.cr[c][k - c * B] = b; j.got = k + 1;
      j.pk = Math.max(j.pk, Math.abs(a), Math.abs(b));
      if ((k + 1) % 2048 === 0) { this.port.postMessage({ pk: j.pk, at: k + 1 }); j.pk = 0; } // for the live picture
    }
    if (f0 + n >= j.at + j.len) { this.send(j); this.job = null; }
    return true;
  }
}
registerProcessor('dub-take', Take);

// dub-clean: passes the sound through, but a broken number (NaN / Infinity) becomes 0 before it reaches the filters
// (a filter that gets one stays broken = silence until reload). Tells the page when it had to (at most once a second).
class Clean extends AudioWorkletProcessor {
  constructor() { super(); this.last = -1e9; }
  process(inputs, outputs) {
    const inp = inputs[0] || [], out = outputs[0]; let bad = false;
    for (let ch = 0; ch < out.length; ch++) {
      const s = inp[ch] || inp[0], o = out[ch]; if (!s) { o.fill(0); continue; }
      for (let i = 0; i < o.length; i++) { const v = s[i]; if (Number.isFinite(v)) o[i] = v; else { o[i] = 0; bad = true; } }
    }
    if (bad && currentTime - this.last > 1) { this.last = currentTime; this.port.postMessage({ bad: true }); }
    return true;
  }
}
registerProcessor('dub-clean', Clean);
