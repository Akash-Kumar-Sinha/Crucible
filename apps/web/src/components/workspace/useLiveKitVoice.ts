"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { orchestratorClient } from "@/api/orchestrator-client";

export type VoiceStatus =
  "idle" | "connecting" | "recording" | "transcribing" | "error";

export interface UseLiveKitVoiceOptions {
  sessionId: string;
  onTranscript?: (transcript: string) => void;
  onAutoSubmit?: (transcript: string) => void;
  autoSubmit?: boolean;
}

export interface UseLiveKitVoiceReturn {
  status: VoiceStatus;
  isRecording: boolean;
  isTranscribing: boolean;
  isConnected: boolean;
  audioLevel: number;
  transcript: string;
  error: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<void>;
  toggleRecording: () => Promise<void>;
  reset: () => void;
}

export function useLiveKitVoice({
  sessionId,
  onTranscript,
  onAutoSubmit,
  autoSubmit = false,
}: UseLiveKitVoiceOptions): UseLiveKitVoiceReturn {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [audioLevel, setAudioLevel] = useState<number>(0);
  const [transcript, setTranscript] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const stopAudioCapture = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    analyserRef.current = null;
    setAudioLevel(0);
  }, []);

  const reset = useCallback(() => {
    stopAudioCapture();
    setStatus("idle");
    setTranscript("");
    setError(null);
    audioChunksRef.current = [];
  }, [stopAudioCapture]);

  const startRecording = useCallback(async () => {
    if (!sessionId) return;
    setError(null);
    setStatus("connecting");

    try {
      // 1. Fetch short-lived token from self-hosted LiveKit room manager
      const tokenRes = await orchestratorClient.getVoiceToken(sessionId);
      if (tokenRes.status !== "success") {
        throw new Error(
          tokenRes.error?.message || "Failed to mint voice room token",
        );
      }

      // 2. Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 3. Setup Web Audio Analyser for real-time waveform level monitoring
      const AudioCtx =
        window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        audioContextRef.current = audioCtx;
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        source.connect(analyser);
        analyserRef.current = analyser;

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateLevel = () => {
          if (analyserRef.current) {
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const avg = sum / dataArray.length;
            const normalized = Math.min(1, Math.max(0, avg / 128));
            setAudioLevel(normalized);
            animFrameRef.current = requestAnimationFrame(updateLevel);
          }
        };
        updateLevel();
      }

      // 4. Initialize MediaRecorder
      audioChunksRef.current = [];
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.start(100);
      setStatus("recording");
    } catch (err: any) {
      stopAudioCapture();
      setStatus("error");
      setError(
        err.message || "Microphone access denied or LiveKit server unreachable",
      );
    }
  }, [sessionId, stopAudioCapture]);

  const stopRecording = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      stopAudioCapture();
      setStatus("idle");
      return;
    }

    setStatus("transcribing");
    stopAudioCapture();

    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });

    try {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: recorder.mimeType || "audio/webm",
      });

      if (audioBlob.size === 0) {
        setStatus("idle");
        return;
      }

      // Convert to Base64
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onloadend = () => {
          const res = reader.result as string;
          const base64 = res.split(",")[1] || res;
          resolve(base64);
        };
        reader.onerror = reject;
      });
      reader.readAsDataURL(audioBlob);
      const audioBase64 = await base64Promise;

      // 5. Send to voice STT endpoint
      const transcribeRes = await orchestratorClient.transcribeAudio(
        sessionId,
        audioBase64,
        audioBlob.type,
      );

      if (
        transcribeRes.status === "success" &&
        transcribeRes.data?.transcript
      ) {
        const text = transcribeRes.data.transcript.trim();
        setTranscript(text);
        if (onTranscript) {
          onTranscript(text);
        }
        if (autoSubmit && onAutoSubmit && text) {
          onAutoSubmit(text);
        }
        setStatus("idle");
      } else {
        setStatus("idle");
      }
    } catch (err: any) {
      setStatus("error");
      setError(err.message || "STT Transcription failed");
      setTimeout(() => {
        setStatus("idle");
      }, 3000);
    } finally {
      audioChunksRef.current = [];
    }
  }, [sessionId, onTranscript, onAutoSubmit, autoSubmit, stopAudioCapture]);

  const toggleRecording = useCallback(async () => {
    if (status === "recording") {
      await stopRecording();
    } else if (status === "idle" || status === "error") {
      await startRecording();
    }
  }, [status, startRecording, stopRecording]);

  useEffect(() => {
    return () => {
      stopAudioCapture();
    };
  }, [stopAudioCapture]);

  return {
    status,
    isRecording: status === "recording",
    isTranscribing: status === "transcribing",
    isConnected: status === "recording" || status === "transcribing",
    audioLevel,
    transcript,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
    reset,
  };
}
