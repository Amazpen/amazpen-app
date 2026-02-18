"use client";

import {
  forwardRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

// ============================================
// Audio Analysis
// ============================================

interface AudioAnalyserOptions {
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
}

function createAudioAnalyser(
  mediaStream: MediaStream,
  options: AudioAnalyserOptions = {}
) {
  const audioContext = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext)();
  const source = audioContext.createMediaStreamSource(mediaStream);
  const analyser = audioContext.createAnalyser();

  if (options.fftSize) analyser.fftSize = options.fftSize;
  if (options.smoothingTimeConstant !== undefined)
    analyser.smoothingTimeConstant = options.smoothingTimeConstant;
  if (options.minDecibels !== undefined)
    analyser.minDecibels = options.minDecibels;
  if (options.maxDecibels !== undefined)
    analyser.maxDecibels = options.maxDecibels;

  source.connect(analyser);

  const cleanup = () => {
    source.disconnect();
    audioContext.close();
  };

  return { analyser, cleanup };
}

// ============================================
// useMultibandVolume Hook
// ============================================

interface MultiBandVolumeOptions {
  bands?: number;
  loPass?: number;
  hiPass?: number;
  updateInterval?: number;
  analyserOptions?: AudioAnalyserOptions;
}

const multibandDefaults: MultiBandVolumeOptions = {
  bands: 5,
  loPass: 100,
  hiPass: 600,
  updateInterval: 32,
  analyserOptions: { fftSize: 2048 },
};

const normalizeDb = (value: number) => {
  if (value === -Infinity) return 0;
  const minDb = -100;
  const maxDb = -10;
  const db = 1 - (Math.max(minDb, Math.min(maxDb, value)) * -1) / 100;
  return Math.sqrt(db);
};

function useMultibandVolume(
  mediaStream?: MediaStream | null,
  options: MultiBandVolumeOptions = {}
) {
  const opts = useMemo(
    () => ({ ...multibandDefaults, ...options }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      options.bands,
      options.loPass,
      options.hiPass,
      options.updateInterval,
      options.analyserOptions?.fftSize,
    ]
  );

  const [frequencyBands, setFrequencyBands] = useState<number[]>(() =>
    new Array(opts.bands).fill(0)
  );
  const bandsRef = useRef<number[]>(new Array(opts.bands).fill(0));
  const frameId = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!mediaStream) {
      const emptyBands = new Array(opts.bands).fill(0);
      setFrequencyBands(emptyBands);
      bandsRef.current = emptyBands;
      return;
    }

    const { analyser, cleanup } = createAudioAnalyser(
      mediaStream,
      opts.analyserOptions
    );

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Float32Array(bufferLength);
    const sliceStart = opts.loPass!;
    const sliceEnd = opts.hiPass!;
    const sliceLength = sliceEnd - sliceStart;
    const chunkSize = Math.ceil(sliceLength / opts.bands!);

    let lastUpdate = 0;
    const updateInterval = opts.updateInterval!;

    const updateVolume = (timestamp: number) => {
      if (timestamp - lastUpdate >= updateInterval) {
        analyser.getFloatFrequencyData(dataArray);

        const chunks = new Array(opts.bands!);
        for (let i = 0; i < opts.bands!; i++) {
          let sum = 0;
          let count = 0;
          const startIdx = sliceStart + i * chunkSize;
          const endIdx = Math.min(sliceStart + (i + 1) * chunkSize, sliceEnd);

          for (let j = startIdx; j < endIdx; j++) {
            sum += normalizeDb(dataArray[j]);
            count++;
          }
          chunks[i] = count > 0 ? sum / count : 0;
        }

        let hasChanged = false;
        for (let i = 0; i < chunks.length; i++) {
          if (Math.abs(chunks[i] - bandsRef.current[i]) > 0.01) {
            hasChanged = true;
            break;
          }
        }

        if (hasChanged) {
          bandsRef.current = chunks;
          setFrequencyBands(chunks);
        }

        lastUpdate = timestamp;
      }

      frameId.current = requestAnimationFrame(updateVolume);
    };

    frameId.current = requestAnimationFrame(updateVolume);

    return () => {
      cleanup();
      if (frameId.current) cancelAnimationFrame(frameId.current);
    };
  }, [mediaStream, opts]);

  return frequencyBands;
}

// ============================================
// BarVisualizer Component
// ============================================

export type BarVisualizerState = "recording" | "idle";

export interface BarVisualizerProps extends HTMLAttributes<HTMLDivElement> {
  state?: BarVisualizerState;
  barCount?: number;
  mediaStream?: MediaStream | null;
  minHeight?: number;
  maxHeight?: number;
}

const BarVisualizerComponent = forwardRef<HTMLDivElement, BarVisualizerProps>(
  (
    {
      state = "idle",
      barCount = 24,
      mediaStream,
      minHeight = 8,
      maxHeight = 100,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const volumeBands = useMultibandVolume(mediaStream, {
      bands: barCount,
      loPass: 80,
      hiPass: 400,
      updateInterval: 40,
    });

    return (
      <div
        ref={ref}
        data-state={state}
        className={cn(
          "relative flex items-center justify-center gap-[3px]",
          className
        )}
        style={style}
        {...props}
      >
        {volumeBands.map((volume, index) => {
          const heightPct = Math.min(
            maxHeight,
            Math.max(minHeight, volume * 100 + 5)
          );

          return (
            <Bar
              key={`bar-${index}`}
              heightPct={heightPct}
              isActive={state === "recording"}
            />
          );
        })}
      </div>
    );
  }
);

const Bar = memo<{
  heightPct: number;
  isActive: boolean;
}>(({ heightPct, isActive }) => (
  <div
    className={cn(
      "min-w-[3px] max-w-[6px] flex-1 rounded-full transition-all duration-100",
      isActive ? "bg-[#6366f1]" : "bg-white/20"
    )}
    style={{ height: `${heightPct}%` }}
  />
));

Bar.displayName = "Bar";

const BarVisualizer = memo(BarVisualizerComponent);
BarVisualizerComponent.displayName = "BarVisualizerComponent";
BarVisualizer.displayName = "BarVisualizer";

export { BarVisualizer };
