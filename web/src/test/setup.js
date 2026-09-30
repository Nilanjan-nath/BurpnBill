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

// jsdom has no object-URL store, so URL.createObjectURL either throws or
// (under vitest's Blob shim) trips over a File built from a raw byte array.
// The item form uses one to preview a photo before it is uploaded; a stable
// fake string is all a test can meaningfully assert on anyway, since nothing
// here decodes an image. Same category of gap as no layout and no Web Audio.
if (!URL.createObjectURL || String(URL.createObjectURL).includes('makeCompatBlob')) {
  let n = 0;
  URL.createObjectURL = () => `blob:burpnbill-test/${++n}`;
  URL.revokeObjectURL = () => {};
}
