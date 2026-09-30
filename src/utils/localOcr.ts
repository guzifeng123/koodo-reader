import { isElectron } from "react-device-detect";

/**
 * Fully-local OCR adapter.
 *
 * Replaces the official online OCR (api.koodoreader.com getOcrResult /
 * getOcrResultV2, which required login + a paid quota) with local engines
 * loaded from the static `public/lib` directory (built to `build/lib`):
 *   - Tesseract:  lib/tesseractjs/tesseract.min.js (+ worker.min.js)
 *   - Paddle/ONNX: lib/onnxruntime-web/ort.min.js + lib/esearch-ocr/esearch-ocr.umd.js
 *
 * The PDF rendering engine (kookit) calls `externalWorker.recognize(image)`
 * and expects a Promise resolving to `{ data: { text: "..." } }` for every
 * engine except `system-ocr` (which returns a plain string and is handled
 * separately, Electron-only).
 *
 * No network request to any koodoreader domain is made here; no login token
 * is required. On the web / Capacitor Android WebView target (isElectron ===
 * false) everything resolves with relative `./lib/...` paths and never
 * touches `window.electronAPI`. If a required engine binary/model is missing
 * the call degrades gracefully to empty text instead of crashing.
 */

declare var window: any;

/** Resolve the static `lib` base dir for the current platform. */
function libBase(): string {
  if (isElectron && window.electronAPI && window.electronAPI.path) {
    const path = window.electronAPI.path;
    const dir = window.electronAPI.sendSync("get-dirname", "ping");
    return `${path.join(dir, "/build/lib")}`;
  }
  // Web / Capacitor: served relative to the document root.
  return "./lib";
}

function loadScript(src: string, globalName?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (globalName && window[globalName]) {
      resolve();
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${src}"]`
    );
    if (existing) {
      if (globalName && window[globalName]) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error(src)));
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

/* ── Tesseract (local) ─────────────────────────────────────────────────── */

interface TesseractWorker {
  recognize: (image: any) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<void>;
}

let tesseractWorkerPromise: Promise<TesseractWorker> | null = null;

async function getTesseractWorker(): Promise<TesseractWorker> {
  if (!tesseractWorkerPromise) {
    tesseractWorkerPromise = (async () => {
      await loadScript(`${libBase()}/tesseractjs/tesseract.min.js`, "Tesseract");
      const Tesseract = window.Tesseract;
      if (!Tesseract || !Tesseract.createWorker) {
        throw new Error("Tesseract local engine unavailable");
      }
      const worker = await Tesseract.createWorker(undefined, undefined, {
        workerPath: `${libBase()}/tesseractjs/worker.min.js`,
        // Core wasm + traineddata are vendored under lib/tesseractjs at build.
        corePath: `${libBase()}/tesseractjs/`,
        langPath: `${libBase()}/tesseractjs/traineddata`,
        gzip: false,
        logger: () => {},
      });
      return worker as TesseractWorker;
    })();
  }
  return tesseractWorkerPromise;
}

async function recognizeWithTesseract(
  image: string,
  lang: string
): Promise<string> {
  const worker = await getTesseractWorker();
  // Load / switch language on the shared worker, then recognize.
  const anyWorker = worker as any;
  if (anyWorker.loadLanguage && anyWorker.initialize) {
    await anyWorker.loadLanguage(lang);
    await anyWorker.initialize(lang);
  }
  const { data } = await worker.recognize(image);
  return (data && data.text) || "";
}

/* ── Paddle / esearch-ocr (local ONNX) ────────────────────────────────── */

interface EsearchOcr {
  init: (options: any) => Promise<void>;
  ocr: (image: any) => Promise<any>;
}

let paddleOcrPromise: Promise<EsearchOcr> | null = null;

async function getPaddleOcr(): Promise<EsearchOcr> {
  if (!paddleOcrPromise) {
    paddleOcrPromise = (async () => {
      await loadScript(`${libBase()}/onnxruntime-web/ort.min.js`, "ort");
      await loadScript(
        `${libBase()}/esearch-ocr/esearch-ocr.umd.js`,
        "esearch-ocr"
      );
      const ort = window.ort;
      const esearchOcr: EsearchOcr = window["esearch-ocr"];
      if (!ort || !ort.InferenceSession || !esearchOcr || !esearchOcr.init) {
        throw new Error("Paddle/OCR local engine unavailable");
      }
      // ONNX det/rec models + decode dictionary are vendored under
      // lib/esearch-ocr/models at build. `locateFile` keeps ort wasm local.
      (ort as any).env = (ort as any).env || {};
      (ort as any).env.wasm = (ort as any).env.wasm || {};
      (ort as any).env.wasm.locateFile = () => `${libBase()}/onnxruntime-web/`;
      await esearchOcr.init({
        ort,
        detPath: `${libBase()}/esearch-ocr/models/det.onnx`,
        recPath: `${libBase()}/esearch-ocr/models/rec.onnx`,
        decodeDic: "",
        imgh: 48,
      });
      return esearchOcr;
    })();
  }
  return paddleOcrPromise;
}

async function recognizeWithPaddle(image: string): Promise<string> {
  const engine = await getPaddleOcr();
  const result = await engine.ocr(image);
  const lines: string[] =
    (result &&
      Array.isArray(result.src) &&
      result.src.map((item: any) => item && item.text).filter(Boolean)) ||
    [];
  return lines.join("\n");
}

/* ── Public entry (matches kookit externalWorker.recognize contract) ───── */

/**
 * Recognize text from an image entirely on-device.
 * Always resolves to `{ data: { text } }`; never calls the official OCR API
 * and never requires login/quota. Failures degrade to empty text.
 */
export const recognizeLocalOcr = async (
  image: string,
  engine: string,
  lang: string
): Promise<{ data: { text: string } }> => {
  let text = "";
  try {
    if (engine === "tesseract") {
      text = await recognizeWithTesseract(image, lang || "chi_sim");
    } else {
      // "paddle" (and any formerly online engine) use the local ONNX engine.
      text = await recognizeWithPaddle(image);
    }
  } catch (e) {
    console.error("[localOcr] recognition failed:", e);
    text = "";
  }
  return { data: { text } };
};
