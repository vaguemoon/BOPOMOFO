import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * 可編譯/可部署版（單檔 React）
 * - 移除重複宣告造成的編譯錯誤
 * - 補齊先前被截斷的檔案尾端
 * - 描寫判定更寬鬆 + 紅線加粗
 * - 通過/未通過（不顯示再描一次）
 * - 闖關式測驗 + 教師門檻設定
 * - 暗色模式切換
 * - 可回傳到 Google Apps Script（建議寫 Google Sheet）
 */

// ===== 儲存鍵 =====
const STORAGE_STATS_KEY = "bopomofo_stats_v2";
const STORAGE_SETTINGS_KEY = "bopomofo_teacher_settings_v2";
const STORAGE_STUDENT_KEY = "bopomofo_student_v2";
const STORAGE_THEME_KEY = "bopomofo_theme_v1";

// ===== 後端端點（請替換成你的 Apps Script URL） =====
const RESULT_ENDPOINT = ""; // 例如：https://script.google.com/macros/s/XXXX/exec

// ===== 注音符號（MVP 先不含聲調） =====
const BOPOMOFO = [
  "ㄅ","ㄆ","ㄇ","ㄈ","ㄉ","ㄊ","ㄋ","ㄌ","ㄍ","ㄎ","ㄏ","ㄐ","ㄑ","ㄒ","ㄓ","ㄔ","ㄕ","ㄖ","ㄗ","ㄘ","ㄙ",
  "ㄧ","ㄨ","ㄩ","ㄚ","ㄛ","ㄜ","ㄝ","ㄞ","ㄟ","ㄠ","ㄡ","ㄢ","ㄣ","ㄤ","ㄥ","ㄦ",
];

// ===== 小工具 =====
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}
function nowIso() {
  return new Date().toISOString();
}
function safeJsonParse<T>(raw: string | null, fallback: T): T {
  try {
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function pickN<T>(arr: T[], n: number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
function pick4(symbols: string[], answer: string) {
  const set = new Set<string>();
  set.add(answer);
  while (set.size < 4) set.add(symbols[Math.floor(Math.random() * symbols.length)]);
  return pickN(Array.from(set), 4);
}
function percent(correct: number, total: number) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}
function deviceId() {
  const key = "bopomofo_device_id_v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = (crypto?.randomUUID?.() ?? `dev_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(key, id);
  return id;
}

// Apps Script 常見 CORS：用 text/plain 送 JSON 字串，避免 preflight 卡住
async function postResult(payload: any) {
  if (!RESULT_ENDPOINT) return { ok: false, skipped: true };
  try {
    const res = await fetch(RESULT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
    });
    return { ok: res.ok, status: res.status };
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) };
  }
}

// ===== 語音：挑較人性的 zh-TW（盡量偏女聲） =====
let _voicePicked: SpeechSynthesisVoice | null = null;

function pickVoice() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const voices = synth.getVoices() || [];
  const hints = ["Yating","Ya-Ting","Mei-Jia","Google 國語","Google Chinese","Microsoft"];

  const candidates = voices
    .filter((v) => (v.lang || "").toLowerCase().includes("zh"))
    .sort((a, b) => {
      const aTW = (a.lang || "").toLowerCase().includes("tw") ? 0 : 1;
      const bTW = (b.lang || "").toLowerCase().includes("tw") ? 0 : 1;
      if (aTW !== bTW) return aTW - bTW;
      const aScore = hints.reduce((s, h) => s + ((a.name || "").includes(h) ? 1 : 0), 0);
      const bScore = hints.reduce((s, h) => s + ((b.name || "").includes(h) ? 1 : 0), 0);
      return bScore - aScore;
    });

  _voicePicked = candidates[0] ?? voices[0] ?? null;
}

function speakHuman(text: string, kind: "bopomofo" | "coach") {
  const synth = window.speechSynthesis;
  if (!synth) return;
  if (!_voicePicked) pickVoice();

  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW";
  if (_voicePicked) u.voice = _voicePicked;

  if (kind === "coach") {
    u.rate = 0.9;
    u.pitch = 1.15;
  } else {
    u.rate = 0.85;
    u.pitch = 1.05;
  }
  synth.speak(u);
}
function speakBopomofo(symbol: string) { speakHuman(symbol, "bopomofo"); }
function speakCoach(text: string) { speakHuman(text, "coach"); }

// ===== 主題（暗色/亮色） =====
type ThemeMode = "light" | "dark";

function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_THEME_KEY);
  if (raw === "dark" || raw === "light") return raw;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}
function saveTheme(m: ThemeMode) {
  localStorage.setItem(STORAGE_THEME_KEY, m);
}
function useThemeClasses(mode: ThemeMode) {
  const dark = mode === "dark";
  return {
    dark,
    pageBg: dark ? "bg-slate-950" : "bg-slate-50",
    text: dark ? "text-slate-50" : "text-slate-900",
    textSub: dark ? "text-slate-300" : "text-slate-600",
    card: dark ? "bg-slate-900 border-slate-700" : "bg-white border-slate-200",
    soft: dark ? "bg-slate-800" : "bg-slate-50",
    pill: dark ? "bg-slate-800 text-slate-100" : "bg-slate-100 text-slate-800",
    btnGhost: dark
      ? "border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800"
      : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
    btnPrimary: dark
      ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
      : "bg-slate-900 text-white hover:bg-slate-800",
  };
}

// ===== 資料結構 =====
type Stats = { correct: number; total: number };

type TeacherSettings = {
  requiredQuestions: number;
  requiredAccuracy: number;
  enabledSymbols: string[];
  autoSpeakOnQuestion: boolean;
  lockAfterPick: boolean;
};

type StudentProfile = {
  studentId: string;
  studentName: string;
};

const DEFAULT_SETTINGS: TeacherSettings = {
  requiredQuestions: 10,
  requiredAccuracy: 80,
  enabledSymbols: [...BOPOMOFO],
  autoSpeakOnQuestion: true,
  lockAfterPick: true,
};

function loadStats(): Stats {
  const s = safeJsonParse<Stats>(localStorage.getItem(STORAGE_STATS_KEY), { correct: 0, total: 0 });
  return {
    correct: Number.isFinite(Number(s.correct)) ? Number(s.correct) : 0,
    total: Number.isFinite(Number(s.total)) ? Number(s.total) : 0,
  };
}
function saveStats(s: Stats) {
  localStorage.setItem(STORAGE_STATS_KEY, JSON.stringify(s));
}
function loadSettings(): TeacherSettings {
  const s = safeJsonParse<TeacherSettings>(localStorage.getItem(STORAGE_SETTINGS_KEY), DEFAULT_SETTINGS);
  const rq = clamp(Number(s.requiredQuestions ?? DEFAULT_SETTINGS.requiredQuestions), 1, 100);
  const ra = clamp(Number(s.requiredAccuracy ?? DEFAULT_SETTINGS.requiredAccuracy), 1, 100);
  const enabled = Array.isArray(s.enabledSymbols) && s.enabledSymbols.length > 0 ? s.enabledSymbols : [...BOPOMOFO];
  return {
    requiredQuestions: rq,
    requiredAccuracy: ra,
    enabledSymbols: enabled.filter((x) => BOPOMOFO.includes(x)),
    autoSpeakOnQuestion: Boolean(s.autoSpeakOnQuestion ?? DEFAULT_SETTINGS.autoSpeakOnQuestion),
    lockAfterPick: Boolean(s.lockAfterPick ?? DEFAULT_SETTINGS.lockAfterPick),
  };
}
function saveSettings(s: TeacherSettings) {
  localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(s));
}
function loadStudent(): StudentProfile {
  return safeJsonParse<StudentProfile>(localStorage.getItem(STORAGE_STUDENT_KEY), { studentId: "", studentName: "" });
}
function saveStudent(s: StudentProfile) {
  localStorage.setItem(STORAGE_STUDENT_KEY, JSON.stringify(s));
}

// ===== UI 元件 =====
function BigPill({ children, cls }: { children: React.ReactNode; cls: ReturnType<typeof useThemeClasses> }) {
  return <div className={`rounded-2xl px-4 py-2 text-sm font-semibold ${cls.pill}`}>{children}</div>;
}
function PrimaryButton({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " +
        (disabled ? "bg-slate-400 text-white" : cls.btnPrimary)
      }
    >
      {children}
    </button>
  );
}
function SecondaryButton({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " +
        (disabled ? "border border-slate-300 bg-white text-slate-300" : cls.btnGhost)
      }
    >
      {children}
    </button>
  );
}

// ===== 描寫評分（非模型、可解釋） =====
function computeExplainableTraceScore({ symbol, drawnCanvas, size }: { symbol: string; drawnCanvas: HTMLCanvasElement; size: number }) {
  const mask = document.createElement("canvas");
  mask.width = size;
  mask.height = size;
  const mctx = mask.getContext("2d");
  if (!mctx) return { score: 0 };

  mctx.fillStyle = "#fff";
  mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = "#000";
  mctx.textAlign = "center";
  mctx.textBaseline = "middle";
  mctx.font = "220px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, Arial";
  mctx.fillText(symbol, size / 2, size / 2 + 10);

  // ✅ 容錯帶加寬：更容易通過
  mctx.strokeStyle = "#000";
  mctx.lineWidth = 34;
  mctx.strokeText(symbol, size / 2, size / 2 + 10);

  const maskData = mctx.getImageData(0, 0, size, size).data;
  const dctx = drawnCanvas.getContext("2d");
  if (!dctx) return { score: 0 };
  const drawData = dctx.getImageData(0, 0, size, size).data;

  let targetArea = 0;
  let drawnTotal = 0;
  let hit = 0;
  let out = 0;

  for (let i = 0; i < maskData.length; i += 4) {
    const isTarget = maskData[i + 3] > 10 && (maskData[i] < 220 || maskData[i + 1] < 220 || maskData[i + 2] < 220);
    if (isTarget) targetArea += 1;

    const r = drawData[i];
    const g = drawData[i + 1];
    const b = drawData[i + 2];
    const a = drawData[i + 3];

    // ✅ 放寬紅色判定（抗鋸齒/裝置差異）
    const isRed = a > 0 && r > 150 && g < 180 && b < 180;
    if (!isRed) continue;

    drawnTotal += 1;
    if (isTarget) hit += 1;
    else out += 1;
  }

  const coverage = targetArea > 0 ? hit / targetArea : 0;
  const outside = drawnTotal > 0 ? out / drawnTotal : 0;

  // ✅ 更寬容：覆蓋率權重高、出界懲罰低、加基礎分
  const raw = coverage * 130 + 12 - outside * 18;
  const score = clamp(Math.round(raw), 0, 100);

  return { score };
}

function TracingCanvas({ symbol, cls }: { symbol: string; cls: ReturnType<typeof useThemeClasses> }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const [passed, setPassed] = useState<boolean | null>(null);
  const size = 320;

  const drawGuide = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    const w = size;
    const h = size;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);

    // 淡格線
    ctx.strokeStyle = "rgba(15,23,42,0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (w * i) / 4;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, h);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(w, p);
      ctx.stroke();
    }

    // 淡灰示範字
    ctx.fillStyle = "rgba(15,23,42,0.18)";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "220px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, Arial";
    ctx.fillText(symbol, w / 2, h / 2 + 10);

    // 外框
    ctx.strokeStyle = "rgba(15,23,42,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  };

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(size * dpr);
    c.height = Math.floor(size * dpr);
    c.style.width = `${size}px`;
    c.style.height = `${size}px`;

    const ctx = c.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    setPassed(null);
    drawGuide();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY
