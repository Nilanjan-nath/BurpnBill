import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

// jsdom doesn't implement the modal <dialog> methods the item sheet uses.
if (!HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

// jsdom doesn't implement the Web Audio API at all — the staff dashboard's
// "new order" chime (staff/chime.js) needs just enough of AudioContext to
// run its code path without throwing, not real sound.
if (!window.AudioContext) {
  class FakeAudioContext {
    state = 'suspended';
    currentTime = 0;
    destination = {};
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
        connect: (dest) => dest, // real AudioNode#connect returns its argument, for a.connect(b).connect(c) chaining
      };
    }
    createOscillator() {
      return { frequency: { value: 0 }, connect: (dest) => dest, start() {}, stop() {} };
    }
  }
  window.AudioContext = FakeAudioContext;
}
