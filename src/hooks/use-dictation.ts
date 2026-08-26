'use client';

/**
 * Voice input for a text field, via the browser's own SpeechRecognition.
 *
 * The browser rather than a server round trip: dictation has to feel immediate,
 * and shipping audio somewhere to be transcribed adds latency, a storage question,
 * and a privacy question for what is often a half-formed thought. The trade is
 * support — Chrome and Safari have it, Firefox does not — so `supported` is part
 * of the contract and callers hide the button when it's false rather than offering
 * something that silently does nothing.
 *
 * Interim results are appended live so the user can see it working, then replaced
 * by the final transcript when the engine settles on one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<
    ArrayLike<{ transcript: string }> & { isFinal: boolean }
  >;
}

function getRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useDictation(onTranscript: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // Kept in a ref so the recognition callbacks always see the CURRENT handler
  // without tearing down and restarting the engine on every render.
  const handlerRef = useRef(onTranscript);
  handlerRef.current = onTranscript;

  useEffect(() => {
    setSupported(!!getRecognitionCtor());
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
      }
      if (finalText.trim()) handlerRef.current(finalText.trim());
    };
    // Any error ends the session rather than leaving a mic button lit with
    // nothing behind it — a denied permission is the common case.
    recognition.onerror = () => stop();
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [stop]);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  // Never leave the microphone open behind an unmounted component.
  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, toggle, stop };
}
