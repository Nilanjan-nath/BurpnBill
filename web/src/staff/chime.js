// A short "new order" ding, generated with the Web Audio API — no audio
// file to bundle or fetch. Browsers refuse to make any sound at all until a
// real user gesture creates or resumes an AudioContext, which is exactly
// why "Turn on sound" (useNewOrderAlerts.js) is a real button someone has
// to click, not something the app can just turn on for itself.
let ctx = null;

export function primeAudio() {
  const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioContextClass) return false; // no Web Audio support — sound just won't be offered
  ctx ??= new AudioContextClass();
  if (ctx.state === 'suspended') ctx.resume();
  return true;
}

// Two rising notes at a clearly audible level: a single quiet 880 Hz blip was
// easy to miss over a kitchen's noise.
export function chime() {
  if (!ctx || ctx.state !== 'running') return; // not primed (or the browser suspended it again)
  const start = ctx.currentTime;
  [880, 1175].forEach((frequency, i) => {
    const now = start + i * 0.18;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.5, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  });
}
