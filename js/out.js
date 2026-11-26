// The way out to the speakers, shared by every page: ... -> safety limiter (-1 dBFS) -> speakers.
// Test mode (?mute): the graph still runs, through a zero gain, so nothing is heard.
// The screen frame (js/shell.js) reads `outMeter` to draw the Output meter and the Now Playing wave.
// Inside Dub (?dub): the page is a hidden sound source for one Dub track.
export const DUB = new URLSearchParams(location.search).has('dub');
export const outMeter = { ctx: null, l: null, r: null, mono: null };

export async function speakerOut(c, mute) {
  await c.audioWorklet.addModule(new URL('./safety-worklet.js?v=1', import.meta.url));
  const node = new AudioWorkletNode(c, 'safety-limiter', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  if (DUB) { // opened inside Dub as a sound source: the sound goes to Dub (a stream), not to the speakers
    const msd = c.createMediaStreamDestination(); msd.channelCount = 2; node.connect(msd);
    window.__dubOut = msd.stream; window.__dubCtx = c; dispatchEvent(new Event('dubout'));
  } else if (!mute) node.connect(c.destination);
  else { const z = c.createGain(); z.gain.value = 0; node.connect(z).connect(c.destination); }
  // taps for the meters (after the limiter = what reaches the speakers)
  const split = c.createChannelSplitter(2);
  const mk = (size) => { const a = c.createAnalyser(); a.fftSize = size; a.smoothingTimeConstant = 0; return a; };
  outMeter.l = mk(2048); outMeter.r = mk(2048); outMeter.mono = mk(32768); // up to ~0.7 s for the Now Playing zoom
  node.connect(split); split.connect(outMeter.l, 0); split.connect(outMeter.r, 1); node.connect(outMeter.mono);
  outMeter.ctx = c;
  return node;
}
