import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * ✅ 穩定可部署版（單檔 React）
 * - 學習：注音發音 + 描寫（通過/未通過、溫和女聲）
 * - 測驗：闖關式精熟（每關固定注音；達標進下一關）
 * - 教師：設定題數門檻/正確率門檻/題庫範圍
 * - 學生：輸入座號/代號（回傳用）
 * - 暗色模式：一鍵切換（存本機）
 * - 回傳：全通關可 POST 到 Apps Script（Google Sheet）
 */

// ===== 你要改的只有這個（你的 Apps Script URL）=====
const RESULT_ENDPOINT = "https://script.google.com/macros/s/AKfycbwAhvscFQQ89eNoJylp0YSDE1quZOyTp3xw0c_GHT9eERfmT4oudba7Mur7qvyTjYgiGg/exec";

// ===== localStorage keys =====
const STORAGE_STATS_KEY = "bopomofo_stats_v3";
const STORAGE_SETTINGS_KEY = "bopomofo_teacher_settings_v3";
const STORAGE_STUDENT_KEY = "bopomofo_student_v3";
const STORAGE_THEME_KEY = "bopomofo_theme_v1";

// ===== 注音符號（先不含聲調）=====
const BOPOMOFO = [
  "ㄅ","ㄆ","ㄇ","ㄈ","ㄉ","ㄊ","ㄋ","ㄌ","ㄍ","ㄎ","ㄏ","ㄐ","ㄑ","ㄒ","ㄓ","ㄔ","ㄕ","ㄖ","ㄗ","ㄘ","ㄙ",
  "ㄧ","ㄨ","ㄩ","ㄚ","ㄛ","ㄜ","ㄝ","ㄞ","ㄟ","ㄠ","ㄡ","ㄢ","ㄣ","ㄤ","ㄥ","ㄦ",
];

// ===== 小工具 =====
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function nowIso() { return new Date().toISOString(); }
function safeJsonParse<T>(raw: string | null, fallback: T): T { try { return raw ? (JSON.parse(raw) as T) : fallback; } catch { return fallback; } }
function percent(correct: number, total: number) { return total > 0 ? Math.round((correct / total) * 100) : 0; }
function pickN<T>(arr: T[], n: number) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
function pick4(symbols: string[], answer: string) {
  const set = new Set<string>(); set.add(answer);
  while (set.size < 4) set.add(symbols[Math.floor(Math.random() * symbols.length)]);
  return pickN(Array.from(set), 4);
}
function deviceId() {
  const key = "bopomofo_device_id_v1";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = (crypto?.randomUUID?.() ?? `dev_${Math.random().toString(16).slice(2)}`);
  localStorage.setItem(key, id);
  return id;
}
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

// ===== 語音：盡量挑人性 zh-TW（偏女聲）=====
let _voicePicked: SpeechSynthesisVoice | null = null;
function pickVoice() {
  const synth = window.speechSynthesis;
  const voices = synth.getVoices() || [];
  const hints = ["Yating", "Ya-Ting", "Mei-Jia", "Google 國語", "Google Chinese", "Microsoft"];
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
  if (!_voicePicked) pickVoice();
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW";
  if (_voicePicked) u.voice = _voicePicked;
  if (kind === "coach") { u.rate = 0.9; u.pitch = 1.15; }
  else { u.rate = 0.85; u.pitch = 1.05; }
  synth.speak(u);
}
function speakBopomofo(symbol: string) { speakHuman(symbol, "bopomofo"); }
function speakCoach(text: string) { speakHuman(text, "coach"); }

// ===== 主題 =====
type ThemeMode = "light" | "dark";
function loadTheme(): ThemeMode {
  const raw = localStorage.getItem(STORAGE_THEME_KEY);
  if (raw === "dark" || raw === "light") return raw;
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches;
  return prefersDark ? "dark" : "light";
}
function saveTheme(m: ThemeMode) { localStorage.setItem(STORAGE_THEME_KEY, m); }
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
    btnGhost: dark ? "border border-slate-700 bg-slate-900 text-slate-100 hover:bg-slate-800" : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",
    btnPrimary: dark ? "bg-emerald-500 text-slate-950 hover:bg-emerald-400" : "bg-slate-900 text-white hover:bg-slate-800",
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
type StudentProfile = { studentId: string; studentName: string };

const DEFAULT_SETTINGS: TeacherSettings = {
  requiredQuestions: 10,
  requiredAccuracy: 80,
  enabledSymbols: [...BOPOMOFO],
  autoSpeakOnQuestion: true,
  lockAfterPick: true,
};

function loadStats(): Stats {
  const s = safeJsonParse<Stats>(localStorage.getItem(STORAGE_STATS_KEY), { correct: 0, total: 0 });
  return { correct: Number(s.correct) || 0, total: Number(s.total) || 0 };
}
function saveStats(s: Stats) { localStorage.setItem(STORAGE_STATS_KEY, JSON.stringify(s)); }
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
function saveSettings(s: TeacherSettings) { localStorage.setItem(STORAGE_SETTINGS_KEY, JSON.stringify(s)); }
function loadStudent(): StudentProfile {
  return safeJsonParse<StudentProfile>(localStorage.getItem(STORAGE_STUDENT_KEY), { studentId: "", studentName: "" });
}
function saveStudent(s: StudentProfile) { localStorage.setItem(STORAGE_STUDENT_KEY, JSON.stringify(s)); }

// ===== UI 小元件 =====
function BigPill({ children, cls }: { children: React.ReactNode; cls: ReturnType<typeof useThemeClasses> }) {
  return <div className={`rounded-2xl px-4 py-2 text-sm font-semibold ${cls.pill}`}>{children}</div>;
}
function PrimaryButton({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={"rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " + (disabled ? "bg-slate-400 text-white" : cls.btnPrimary)}>
      {children}
    </button>
  );
}
function SecondaryButton({ children, onClick, disabled, cls }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={"rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " + (disabled ? "border border-slate-300 bg-white text-slate-300" : cls.btnGhost)}>
      {children}
    </button>
  );
}

// ===== 描寫評分（非模型、可解釋）=====
function computeExplainableTraceScore({ symbol, drawnCanvas, size }: { symbol: string; drawnCanvas: HTMLCanvasElement; size: number }) {
  const mask = document.createElement("canvas");
  mask.width = size; mask.height = size;
  const mctx = mask.getContext("2d"); if (!mctx) return { score: 0 };

  mctx.fillStyle = "#fff"; mctx.fillRect(0, 0, size, size);
  mctx.fillStyle = "#000";
  mctx.textAlign = "center"; mctx.textBaseline = "middle";
  mctx.font = "220px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, Arial";
  mctx.fillText(symbol, size / 2, size / 2 + 10);
  mctx.strokeStyle = "#000";
  mctx.lineWidth = 34; // 容錯帶（更好過）
  mctx.strokeText(symbol, size / 2, size / 2 + 10);

  const maskData = mctx.getImageData(0, 0, size, size).data;
  const dctx = drawnCanvas.getContext("2d"); if (!dctx) return { score: 0 };
  const drawData = dctx.getImageData(0, 0, size, size).data;

  let targetArea = 0, drawnTotal = 0, hit = 0, out = 0;

  for (let i = 0; i < maskData.length; i += 4) {
    const isTarget = maskData[i + 3] > 10 && (maskData[i] < 220 || maskData[i + 1] < 220 || maskData[i + 2] < 220);
    if (isTarget) targetArea++;

    const r = drawData[i], g = drawData[i + 1], b = drawData[i + 2], a = drawData[i + 3];
    const isRed = a > 0 && r > 150 && g < 180 && b < 180; // 放寬紅線
    if (!isRed) continue;

    drawnTotal++;
    if (isTarget) hit++;
    else out++;
  }

  const coverage = targetArea ? hit / targetArea : 0;
  const outside = drawnTotal ? out / drawnTotal : 0;

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
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    // ✅ dpr setTransform 後，用 CSS 像素 size 來畫（避免「我畫很準卻不過」的對不齊 bug）
    const w = size, h = size;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(15,23,42,0.08)"; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const p = (w * i) / 4;
      ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, h); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(w, p); ctx.stroke();
    }

    ctx.fillStyle = "rgba(15,23,42,0.18)";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "220px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Noto Sans TC, Arial";
    ctx.fillText(symbol, w / 2, h / 2 + 10);

    ctx.strokeStyle = "rgba(15,23,42,0.12)";
    ctx.lineWidth = 2;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  };

  useEffect(() => {
    const c = canvasRef.current; if (!c) return;
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
    const c = canvasRef.current; if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return { x: clamp(e.clientX - r.left, 0, r.width), y: clamp(e.clientY - r.top, 0, r.height) };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    last.current = getPos(e);
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d"); if (!ctx) return;

    const p = getPos(e);
    const prev = last.current;
    if (!prev) { last.current = p; return; }

    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 20; // 加粗
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };

  const onUp = () => { drawing.current = false; last.current = null; };

  const clearRedraw = () => { setPassed(null); drawGuide(); };

  const grade = () => {
    const c = canvasRef.current; if (!c) return;

    const flat = document.createElement("canvas");
    flat.width = size; flat.height = size;
    const fctx = flat.getContext("2d"); if (!fctx) return;
    fctx.drawImage(c, 0, 0, size, size);

    const r = computeExplainableTraceScore({ symbol, drawnCanvas: flat, size });
    const ok = r.score >= 60;
    setPassed(ok);
    speakCoach(ok ? "你通過了!" : "未通過，再試試看。");
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <canvas
        ref={canvasRef}
        className={"touch-none rounded-3xl border bg-white shadow-sm " + (cls.dark ? "border-slate-700" : "border-slate-200")}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />

      <div className="flex flex-wrap gap-2">
        <SecondaryButton cls={cls} onClick={clearRedraw}>清除重來</SecondaryButton>
        <PrimaryButton cls={cls} onClick={grade}>完成評分</PrimaryButton>
      </div>

      <div className={"w-full max-w-[360px] rounded-3xl border p-4 " + (cls.dark ? "border-slate-700 bg-slate-900" : "border-slate-200 bg-white")} aria-live="polite">
        <div className={"text-xs font-black " + (cls.dark ? "text-slate-200" : "text-slate-700")}>描寫結果</div>
        {passed == null ? (
          <div className={"mt-2 text-sm font-semibold " + (cls.dark ? "text-slate-300" : "text-slate-600")}>畫完按「完成評分」。</div>
        ) : passed ? (
          <div className="mt-3 text-3xl font-black text-emerald-500">✅ 通過</div>
        ) : (
          <div className="mt-3 text-3xl font-black text-rose-500">❌ 未通過</div>
        )}
      </div>
    </div>
  );
}

function StudentPanel({ student, setStudent, cls }: { student: StudentProfile; setStudent: (s: StudentProfile) => void; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${cls.card}`}>
      <div className={`text-sm font-black ${cls.text}`}>學生資料</div>
      <div className={`mt-1 text-xs font-semibold ${cls.textSub}`}>座號/代號必填（回傳老師用）。</div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={"text-xs font-black " + (cls.dark ? "text-slate-200" : "text-slate-700")}>座號/代號（必填）</span>
          <input
            value={student.studentId}
            onChange={(e) => setStudent({ ...student, studentId: e.target.value })}
            className={"rounded-2xl border px-4 py-3 text-base font-bold outline-none " + (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 focus:border-slate-500" : "border-slate-200 bg-white text-slate-900 focus:border-slate-400")}
            placeholder="例如：A03"
            maxLength={12}
          />
        </label>

        <label className="grid gap-1">
          <span className={"text-xs font-black " + (cls.dark ? "text-slate-200" : "text-slate-700")}>姓名（可不填）</span>
          <input
            value={student.studentName}
            onChange={(e) => setStudent({ ...student, studentName: e.target.value })}
            className={"rounded-2xl border px-4 py-3 text-base font-bold outline-none " + (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 focus:border-slate-500" : "border-slate-200 bg-white text-slate-900 focus:border-slate-400")}
            placeholder="例如：小明"
            maxLength={20}
          />
        </label>
      </div>
    </div>
  );
}

function TeacherPanel({ settings, setSettings, cls }: { settings: TeacherSettings; setSettings: (s: TeacherSettings) => void; cls: ReturnType<typeof useThemeClasses> }) {
  const toggleSymbol = (sym: string) => {
    const set = new Set(settings.enabledSymbols);
    if (set.has(sym)) set.delete(sym); else set.add(sym);
    const next = { ...settings, enabledSymbols: Array.from(set) };
    setSettings(next); saveSettings(next);
  };

  const setRq = (n: number) => { const next = { ...settings, requiredQuestions: clamp(n, 1, 100) }; setSettings(next); saveSettings(next); };
  const setRa = (n: number) => { const next = { ...settings, requiredAccuracy: clamp(n, 1, 100) }; setSettings(next); saveSettings(next); };

  return (
    <div className={`rounded-3xl border p-5 shadow-sm ${cls.card}`}>
      <div className={`text-sm font-black ${cls.text}`}>教師設定（闖關通過標準）</div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className={"text-xs font-black " + (cls.dark ? "text-slate-200" : "text-slate-700")}>題數門檻</span>
          <input type="number" value={settings.requiredQuestions}
            onChange={(e) => setRq(Number(e.target.value))}
            className={"rounded-2xl border px-4 py-3 text-base font-bold outline-none " + (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900")}
            min={1} max={100} />
        </label>

        <label className="grid gap-1">
          <span className={"text-xs font-black " + (cls.dark ? "text-slate-200" : "text-slate-700")}>正確率門檻（%）</span>
          <input type="number" value={settings.requiredAccuracy}
            onChange={(e) => setRa(Number(e.target.value))}
            className={"rounded-2xl border px-4 py-3 text-base font-bold outline-none " + (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100" : "border-slate-200 bg-white text-slate-900")}
            min={1} max={100} />
        </label>
      </div>

      <div className="mt-4 grid gap-2">
        <label className={"flex items-center gap-2 text-sm font-bold " + (cls.dark ? "text-slate-100" : "text-slate-800")}>
          <input type="checkbox" checked={settings.autoSpeakOnQuestion}
            onChange={(e) => { const next = { ...settings, autoSpeakOnQuestion: e.target.checked }; setSettings(next); saveSettings(next); }} />
          每題開始自動播一次
        </label>

        <label className={"flex items-center gap-2 text-sm font-bold " + (cls.dark ? "text-slate-100" : "text-slate-800")}>
          <input type="checkbox" checked={settings.lockAfterPick}
            onChange={(e) => { const next = { ...settings, lockAfterPick: e.target.checked }; setSettings(next); saveSettings(next); }} />
          選完鎖定（避免連點）
        </label>

        <div className={"text-xs font-semibold " + cls.textSub}>已選符號：{settings.enabledSymbols.length} / {BOPOMOFO.length}</div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={() => { const next = { ...settings, enabledSymbols: [...BOPOMOFO] }; setSettings(next); saveSettings(next); }}
          className={"rounded-2xl border px-4 py-2 text-sm font-black " + cls.btnGhost}>全選</button>
        <button onClick={() => { const next = { ...settings, enabledSymbols: [] }; setSettings(next); saveSettings(next); }}
          className={"rounded-2xl border px-4 py-2 text-sm font-black " + cls.btnGhost}>全不選</button>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {BOPOMOFO.map((s) => {
          const on = settings.enabledSymbols.includes(s);
          return (
            <button key={s} onClick={() => toggleSymbol(s)}
              className={"rounded-2xl border px-4 py-3 text-xl font-black shadow-sm active:scale-[0.99] " +
                (on ? (cls.dark ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-900 bg-slate-900 text-white")
                    : (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"))}>
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LearnPanel({ symbol, setSymbol, cls }: { symbol: string; setSymbol: (s: string) => void; cls: ReturnType<typeof useThemeClasses> }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={`rounded-3xl border p-5 shadow-sm ${cls.card}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className={`text-base font-black ${cls.text}`}>學習：聽 + 看 + 描</div>
            <div className={`text-xs font-semibold ${cls.textSub}`}>先按發音，再描寫。</div>
          </div>
          <PrimaryButton cls={cls} onClick={() => speakBopomofo(symbol)}>發音 ▶</PrimaryButton>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {BOPOMOFO.map((s) => (
            <button key={s} onClick={() => setSymbol(s)}
              className={"rounded-2xl border px-4 py-3 text-xl font-black shadow-sm active:scale-[0.99] " +
                (s === symbol
                  ? (cls.dark ? "border-emerald-400 bg-emerald-500 text-slate-950" : "border-slate-900 bg-slate-900 text-white")
                  : (cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"))}>
              {s}
            </button>
          ))}
        </div>

        <div className={`mt-5 rounded-3xl p-5 ${cls.soft}`}>
          <div className="flex items-end justify-between">
            <div className={`text-7xl font-black tracking-wide ${cls.text}`}>{symbol}</div>
            <div className={`text-right text-xs font-semibold ${cls.textSub}`}>提示：聽 2 次再描。</div>
          </div>
        </div>
      </div>

      <div className={`rounded-3xl border p-5 shadow-sm ${cls.card}`}>
        <div className={`text-base font-black ${cls.text}`}>紅線描寫（通過 / 未通過）</div>
        <div className={`mt-1 text-xs font-semibold ${cls.textSub}`}>完成後按「完成評分」。</div>
        <div className="mt-4">
          <TracingCanvas symbol={symbol} cls={cls} />
        </div>
      </div>
    </div>
  );
}

function MasteryQuiz({ settings, student, globalStats, setGlobalStats, cls }: { settings: TeacherSettings; student: StudentProfile; globalStats: Stats; setGlobalStats: (s: Stats) => void; cls: ReturnType<typeof useThemeClasses> }) {
  const levels = settings.enabledSymbols.length > 0 ? settings.enabledSymbols : [...BOPOMOFO];
  const totalLevels = levels.length;

  const [phase, setPhase] = useState<"ready" | "inLevel" | "allClear">("ready");
  const [levelIndex, setLevelIndex] = useState(0);

  const levelSymbol = levels[levelIndex] ?? levels[0] ?? "ㄅ";

  const [qIndex, setQIndex] = useState(0);
  const [levelCorrect, setLevelCorrect] = useState(0);
  const [levelTotal, setLevelTotal] = useState(0);

  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<null | { ok: boolean; picked: string }>(null);

  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<string>("");

  const options = useMemo(() => pick4(levels, levelSymbol), [levels, levelSymbol, qIndex]);
  const levelAcc = percent(levelCorrect, levelTotal);
  const levelPassed = levelTotal >= settings.requiredQuestions && levelAcc >= settings.requiredAccuracy;

  const studentReady = student.studentId.trim().length > 0;

  const start = () => {
    setPhase("inLevel");
    setLevelIndex(0);
    setQIndex(1);
    setLevelCorrect(0);
    setLevelTotal(0);
    setFeedback(null);
    setLocked(false);
    setSendStatus("");
    if (settings.autoSpeakOnQuestion) setTimeout(() => speakBopomofo(levels[0] ?? "ㄅ"), 120);
  };

  const resetLevel = () => {
    setQIndex(1);
    setLevelCorrect(0);
    setLevelTotal(0);
    setFeedback(null);
    setLocked(false);
    if (settings.autoSpeakOnQuestion) setTimeout(() => speakBopomofo(levelSymbol), 120);
  };

  const nextLevel = () => {
    const next = levelIndex + 1;
    if (next >= totalLevels) {
      setPhase("allClear");
      speakCoach("你通過了!");
      return;
    }
    setLevelIndex(next);
    setQIndex(1);
    setLevelCorrect(0);
    setLevelTotal(0);
    setFeedback(null);
    setLocked(false);
    speakCoach("太好了，進入下一關。");
    if (settings.autoSpeakOnQuestion) setTimeout(() => speakBopomofo(levels[next]), 200);
  };

  const pick = (s: string) => {
    if (locked) return;
    const ok = s === levelSymbol;
    setLevelTotal((t) => t + 1);
    setLevelCorrect((c) => c + (ok ? 1 : 0));
    setFeedback({ ok, picked: s });
    if (settings.lockAfterPick) setLocked(true);
    setTimeout(() => speakBopomofo(levelSymbol), 120);
  };

  const nextQuestion = () => {
    setQIndex((x) => x + 1);
    setFeedback(null);
    setLocked(false);
    if (settings.autoSpeakOnQuestion) setTimeout(() => speakBopomofo(levelSymbol), 80);
  };

  const finishLevel = () => {
    if (levelPassed) {
      speakCoach("你通過了!");
      const nextGlobal: Stats = { correct: globalStats.correct + levelCorrect, total: globalStats.total + levelTotal };
      setGlobalStats(nextGlobal);
      saveStats(nextGlobal);
      nextLevel();
    } else {
      speakCoach("未通過，再試試看。");
      resetLevel();
    }
  };

  const postAllClear = async () => {
    setSending(true);
    const payload = {
      type: "bopomofo_checkpoint_result",
      timestamp: nowIso(),
      deviceId: deviceId(),
      student,
      settings: {
        requiredQuestions: settings.requiredQuestions,
        requiredAccuracy: settings.requiredAccuracy,
        enabledSymbols: levels,
        mode: "checkpoint"
      },
      summary: { totalLevels, clearedLevels: totalLevels }
    };

    const r = await postResult(payload);
    setSending(false);
    if (r.skipped) setSendStatus("（尚未設定回傳端點：結果只保留在本機）");
    else if (r.ok) setSendStatus("✅ 已回傳給老師");
    else setSendStatus("⚠️ 回傳失敗（請檢查端點/網路）");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className={`rounded-3xl border p-5 shadow-sm lg:col-span-2 ${cls.card}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className={`text-base font-black ${cls.text}`}>測驗：闖關模式</div>
            <div className={`text-xs font-semibold ${cls.textSub}`}>每關固定一個注音：達標就進下一關。</div>
          </div>

          <div className="flex gap-2">
            <SecondaryButton cls={cls} onClick={() => speakBopomofo(levelSymbol)} disabled={phase !== "inLevel"}>再聽一次 ▶</SecondaryButton>
            {phase === "ready" ? (
              <PrimaryButton cls={cls} onClick={start} disabled={!studentReady || totalLevels === 0}>開始闖關</PrimaryButton>
            ) : (
              <SecondaryButton cls={cls} onClick={() => { setPhase("ready"); setLevelIndex(0); setQIndex(0); setLevelCorrect(0); setLevelTotal(0); setFeedback(null); setLocked(false); setSendStatus(""); setSending(false); }}>
                回到開始
              </SecondaryButton>
            )}
          </div>
        </div>

        <div className={`mt-4 rounded-3xl p-4 ${cls.soft}`}>
          {phase === "ready" ? (
            <div className="grid gap-2">
              <div className={`text-lg font-black ${cls.text}`}>準備好了就開始</div>
              <div className={"text-sm font-semibold " + (cls.dark ? "text-slate-200" : "text-slate-700")}>
                本關標準：至少 {settings.requiredQuestions} 題、正確率至少 {settings.requiredAccuracy}%
              </div>
              <div className={`text-xs font-semibold ${cls.textSub}`}>共 {totalLevels} 關</div>
            </div>
          ) : phase === "inLevel" ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <BigPill cls={cls}>第 {levelIndex + 1} / {totalLevels} 關</BigPill>
                <BigPill cls={cls}>目標：{levelSymbol}</BigPill>
                <BigPill cls={cls}>已做 {levelTotal} 題</BigPill>
                <BigPill cls={cls}>正確率 {percent(levelCorrect, levelTotal)}%</BigPill>
              </div>
              <div className={`mt-3 rounded-3xl p-5 ${cls.dark ? "bg-slate-950" : "bg-white"} border ${cls.dark ? "border-slate-700" : "border-slate-200"}`}>
                <div className={`text-7xl font-black ${cls.text}`}>{levelSymbol}</div>
                <div className={`mt-1 text-xs font-semibold ${cls.textSub}`}>按「再聽一次」或直接選。</div>
              </div>
            </>
          ) : (
            <div className={`rounded-3xl border p-5 ${cls.dark ? "border-emerald-700 bg-emerald-950 text-emerald-200" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
              <div className="text-2xl font-black">🎉 全部通關！</div>
            </div>
          )}
        </div>

        {phase === "inLevel" && (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {options.map((s) => {
                const isPicked = feedback?.picked === s;
                const isAnswer = s === levelSymbol;

                const base = cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 hover:bg-slate-900" : "border-slate-200 bg-white hover:bg-slate-50";
                const okBox = cls.dark ? "border-emerald-400 bg-emerald-950" : "border-emerald-600 bg-emerald-50";
                const badBox = cls.dark ? "border-rose-400 bg-rose-950" : "border-rose-600 bg-rose-50";

                const btn =
                  "rounded-3xl border px-4 py-6 text-5xl font-black shadow-sm active:scale-[0.99] " +
                  (!feedback ? base : isAnswer ? okBox : isPicked ? badBox : cls.dark ? "border-slate-700 bg-slate-950 text-slate-100 opacity-60" : "border-slate-200 bg-white opacity-60");

                return <button key={s} onClick={() => pick(s)} className={btn}>{s}</button>;
              })}
            </div>

            <div className={`mt-4 min-h-[56px] rounded-3xl px-4 py-4 text-base font-bold ${cls.soft} ${cls.dark ? "text-slate-100" : "text-slate-700"}`}>
              {!feedback ? "先聽，再選。" : feedback.ok ? "✅ 答對！" : "❌ 未通過，再試試看。"}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <SecondaryButton cls={cls} onClick={() => speakBopomofo(levelSymbol)}>再聽一次 ▶</SecondaryButton>
              {levelTotal >= settings.requiredQuestions ? (
                <PrimaryButton cls={cls} onClick={finishLevel}>看本關結果</PrimaryButton>
              ) : (
                <PrimaryButton cls={cls} onClick={nextQuestion}>下一題 →</PrimaryButton>
              )}
            </div>
          </>
        )}

        {phase === "allClear" && (
          <div className={`mt-4 rounded-3xl p-4 ${cls.soft}`}>
            <div className={`text-lg font-black ${cls.text}`}>🎉 全部通關！</div>
            <div className={"mt-1 text-sm font-semibold " + (cls.dark ? "text-slate-200" : "text-slate-700")}>
              你已經把選定的 {totalLevels} 個注音都通過了。
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <PrimaryButton cls={cls} onClick={postAllClear} disabled={sending}>回傳給老師</PrimaryButton>
              <SecondaryButton cls={cls} onClick={() => { setPhase("ready"); setLevelIndex(0); setQIndex(0); setLevelCorrect(0); setLevelTotal(0); setFeedback(null); setLocked(false); setSendStatus(""); setSending(false); }}>
                再玩一次
              </SecondaryButton>
            </div>
            <div className={"mt-2 text-sm font-semibold " + (cls.dark ? "text-slate-200" : "text-slate-700")}>
              {sending ? "回傳中…" : sendStatus}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className={`rounded-3xl border p-5 shadow-sm ${cls.card}`}>
          <div className={`text-sm font-black ${cls.text}`}>本機累積紀錄</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <BigPill cls={cls}>答對 {globalStats.correct}</BigPill>
            <BigPill cls={cls}>總題數 {globalStats.total}</BigPill>
            <BigPill cls={cls}>正確率 {percent(globalStats.correct, globalStats.total)}%</BigPill>
          </div>
          <div className="mt-4">
            <SecondaryButton cls={cls} onClick={() => { const cleared = { correct: 0, total: 0 }; setGlobalStats(cleared); saveStats(cleared); }}>
              清空本機紀錄
            </SecondaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<"learn" | "quiz" | "teacher">("learn");
  const [symbol, setSymbol] = useState("ㄅ");

  const [settings, setSettings] = useState<TeacherSettings>(DEFAULT_SETTINGS);
  const [student, setStudent] = useState<StudentProfile>({ studentId: "", studentName: "" });
  const [stats, setStats] = useState<Stats>({ correct: 0, total: 0 });
  const [theme, setTheme] = useState<ThemeMode>("light");

  const cls = useMemo(() => useThemeClasses(theme), [theme]);

  useEffect(() => {
    setSettings(loadSettings());
    setStudent(loadStudent());
    setStats(loadStats());
    setTheme(loadTheme());
    deviceId();

    pickVoice();
    window.speechSynthesis.onvoiceschanged = () => pickVoice();
  }, []);

  useEffect(() => { saveStudent(student); }, [student]);

  return (
    <div className={`min-h-screen ${cls.pageBg}`}>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className={`text-2xl font-black tracking-tight ${cls.text}`}>注音符號單音｜精熟練習</div>
            <div className={`text-sm font-semibold ${cls.textSub}`}>低年級智能障礙：畫面精簡、提示顯著、可獨立操作</div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <SecondaryButton cls={cls} onClick={() => { const next = theme === "dark" ? "light" : "dark"; setTheme(next); saveTheme(next); }}>
              {theme === "dark" ? "☀️ 亮色" : "🌙 暗色"}
            </SecondaryButton>
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-start gap-2">
          <button onClick={() => setTab("learn")}
            className={"rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " + (tab === "learn" ? (cls.dark ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-white") : cls.btnGhost)}>
            學習
          </button>
          <button onClick={() => setTab("quiz")}
            className={"rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " + (tab === "quiz" ? (cls.dark ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-white") : cls.btnGhost)}>
            測驗
          </button>
          <button onClick={() => setTab("teacher")}
            className={"rounded-3xl px-5 py-3 text-base font-black shadow-sm active:scale-[0.99] " + (tab === "teacher" ? (cls.dark ? "bg-emerald-500 text-slate-950" : "bg-slate-900 text-white") : cls.btnGhost)}>
            教師
          </button>

          <div className="w-full lg:ml-auto lg:w-[520px]">
            <StudentPanel
              cls={cls}
              student={student}
              setStudent={(s) => setStudent({
                studentId: s.studentId.replace(/\s+/g, "").slice(0, 12),
                studentName: s.studentName.slice(0, 20)
              })}
            />
          </div>
        </div>

        <main className="mt-6">
          {tab === "learn" ? (
            <LearnPanel cls={cls} symbol={symbol} setSymbol={setSymbol} />
          ) : tab === "quiz" ? (
            <MasteryQuiz cls={cls} settings={settings} student={student} globalStats={stats} setGlobalStats={setStats} />
          ) : (
            <TeacherPanel cls={cls} settings={settings} setSettings={setSettings} />
          )}
        </main>

        <footer className={"mt-10 rounded-3xl border p-5 text-xs font-semibold shadow-sm " + cls.card + " " + cls.textSub}>
          <div className={"text-sm font-black " + cls.text}>部署提示</div>
          <div className="mt-2 grid gap-1">
            <div>1) 記得把 vite.config.ts 的 base 改成 /你的repo名稱/</div>
            <div>2) 記得把 RESULT_ENDPOINT 換成你的 Apps Script URL（才會回傳到 Google Sheet）</div>
          </div>
        </footer>
      </div>
    </div>
  );
}
