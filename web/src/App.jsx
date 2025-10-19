import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Constants
const DEFAULT_MODEL = "gpt-4o-mini";
const LOCALSTORAGE_DEBOUNCE_MS = 500;
const AUTO_START_DELAY_MS = 100;

// Error Boundary Component
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("DevTimer Error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w" style={{ textAlign: "center", paddingTop: "10vh" }}>
          <div className="card" style={{ maxWidth: 500, margin: "0 auto" }}>
            <h2 style={{ fontSize: 24, marginBottom: 16 }}>⚠️ Something went wrong</h2>
            <p className="subtle" style={{ marginBottom: 16 }}>
              {this.state.error?.message || "An unexpected error occurred"}
            </p>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              Reload App
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// Debounced localStorage hook
function useDebouncedLocalStorage(key, value, delay = LOCALSTORAGE_DEBOUNCE_MS) {
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    
    timeoutRef.current = setTimeout(() => {
      setLS(key, value);
    }, delay);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [key, value, delay]);
}

function App() {
  // Core durations
  const [focusMins, setFocusMins] = useState(() => getLS("focusMins", 25));
  const [shortBreakMins, setShortBreakMins] = useState(() => getLS("shortBreakMins", 5));
  const [longBreakMins, setLongBreakMins] = useState(() => getLS("longBreakMins", 15));
  const [cyclesUntilLong, setCyclesUntilLong] = useState(() => getLS("cyclesUntilLong", 4));

  // Timer state
  const [phase, setPhase] = useState(() => getLS("phase", "focus"));
  const [secondsLeft, setSecondsLeft] = useState(() => getLS("secondsLeft", 25 * 60));
  const [isRunning, setIsRunning] = useState(false);
  const [completedFocus, setCompletedFocus] = useState(() => getLS("completedFocus", 0));

  // UI
  const [showSettings, setShowSettings] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [aiOpen, setAiOpen] = useState(true);

  // AI
  const [aiMessage, setAiMessage] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [useLocalAI, setUseLocalAI] = useState(() => getLS("useLocalAI", false));
  const [model, setModel] = useState(() => getLS("openaiModel", DEFAULT_MODEL));

  // Voice
  const [enableVoice, setEnableVoice] = useState(() => getLS("enableVoice", true));
  const [openaiVoice, setOpenaiVoice] = useState(() => getLS("openaiVoice", "alloy"));
  const [browserVoice, setBrowserVoice] = useState(() => getLS("browserVoice", ""));
  const [browserVoices, setBrowserVoices] = useState([]);

  const tickRef = useRef(null);
  const completionHandledRef = useRef(false); // Prevent double-firing

  // Calculate total seconds for current phase
  const totalSeconds = useMemo(() => {
    const mins = phase === "focus" ? focusMins : phase === "short" ? shortBreakMins : longBreakMins;
    return mins * 60;
  }, [phase, focusMins, shortBreakMins, longBreakMins]);

  // Debounced localStorage persistence
  useDebouncedLocalStorage("focusMins", focusMins);
  useDebouncedLocalStorage("shortBreakMins", shortBreakMins);
  useDebouncedLocalStorage("longBreakMins", longBreakMins);
  useDebouncedLocalStorage("cyclesUntilLong", cyclesUntilLong);
  useDebouncedLocalStorage("phase", phase);
  useDebouncedLocalStorage("secondsLeft", secondsLeft);
  useDebouncedLocalStorage("completedFocus", completedFocus);
  useDebouncedLocalStorage("openaiModel", model);
  useDebouncedLocalStorage("useLocalAI", useLocalAI);
  useDebouncedLocalStorage("enableVoice", enableVoice);
  useDebouncedLocalStorage("openaiVoice", openaiVoice);
  useDebouncedLocalStorage("browserVoice", browserVoice);

  // Browser voices dropdown
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    
    const capture = () => {
      const list = window.speechSynthesis.getVoices() || [];
      const rows = list.map(v => ({ name: v.name, lang: v.lang }));
      setBrowserVoices(rows);
      
      if (!browserVoice && rows.length) {
        const prefer = rows.find(v => /aria|female|samantha|victoria|serena|zira/i.test(v.name)) || rows[0];
        setBrowserVoice(prefer.name);
      }
    };
    
    capture();
    window.speechSynthesis.onvoiceschanged = capture;
    
    return () => { 
      window.speechSynthesis.onvoiceschanged = null; 
    };
  }, [browserVoice]);

  // Sync timer when idle and settings change
  useEffect(() => {
    if (!isRunning) {
      setSecondsLeft(totalSeconds);
    }
  }, [isRunning, totalSeconds]);

  // Timer loop
  useEffect(() => {
    if (!isRunning) return;
    
    tickRef.current = setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    
    return () => clearInterval(tickRef.current);
  }, [isRunning]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (window.__devtimerAudio) {
        try {
          window.__devtimerAudio.pause();
          window.__devtimerAudio = null;
        } catch {}
      }
    };
  }, []);

  // Completion handler with proper dependencies
  useEffect(() => {
    if (secondsLeft > 0 || completionHandledRef.current) return;

    completionHandledRef.current = true;
    clearInterval(tickRef.current);

    const handleCompletion = async () => {
      if (phase === "focus") {
        const newCount = completedFocus + 1;
        setCompletedFocus(newCount);

        const suggestion =
          `Great work! You finished a ${focusMins}-minute focus block. ` +
          `Take a ${shortBreakMins}-minute stretch break to reset your mind.`;

        setAiLoading(true);
        try {
          const msg = await getAIFeedback({
            model,
            useLocalAI,
            context: {
              phase: "focus",
              focusMins,
              shortBreakMins,
              longBreakMins,
              completedFocus: newCount,
              productivityNote: "Session complete",
            },
            defaultMessage: suggestion,
          });
          setAiMessage(msg);
          await maybeSpeak(msg, { openaiVoice, enableVoice, browserVoice });
        } catch (err) {
          console.error("AI feedback error:", err);
          setAiMessage(suggestion);
          await maybeSpeak(suggestion, { openaiVoice, enableVoice, browserVoice });
        } finally {
          setAiLoading(false);
        }

        // Decide next phase & duration
        const nextPhase = (newCount % cyclesUntilLong === 0) ? "long" : "short";
        const nextSeconds = nextPhase === "short" ? shortBreakMins * 60 : longBreakMins * 60;
        
        setPhase(nextPhase);
        setSecondsLeft(nextSeconds);
        setIsRunning(false);
        
        setTimeout(() => {
          completionHandledRef.current = false;
          setIsRunning(true);
        }, AUTO_START_DELAY_MS);

      } else if (phase === "short" || phase === "long") {
        const suggestion = phase === "short"
          ? `Break done! Get ready for another ${focusMins}-minute deep-focus sprint`
          : `Long break complete. Easing back into a ${focusMins}-minute focus block will keep momentum.`;

        setAiLoading(true);
        try {
          const msg = await getAIFeedback({
            model,
            useLocalAI,
            context: { phase, focusMins, shortBreakMins, longBreakMins, completedFocus },
            defaultMessage: suggestion,
          });
          setAiMessage(msg);
          await maybeSpeak(msg, { openaiVoice, enableVoice, browserVoice });
        } catch (err) {
          console.error("AI feedback error:", err);
          setAiMessage(suggestion);
          await maybeSpeak(suggestion, { openaiVoice, enableVoice, browserVoice });
        } finally {
          setAiLoading(false);
        }

        // Back to focus
        setPhase("focus");
        setSecondsLeft(focusMins * 60);
        setIsRunning(false);
        
        setTimeout(() => {
          completionHandledRef.current = false;
          setIsRunning(true);
        }, AUTO_START_DELAY_MS);
      }
    };

    handleCompletion();
  }, [
    secondsLeft,
    phase,
    focusMins,
    shortBreakMins,
    longBreakMins,
    completedFocus,
    cyclesUntilLong,
    model,
    useLocalAI,
    openaiVoice,
    enableVoice,
    browserVoice
  ]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;

  const start = useCallback(() => {
    if (secondsLeft <= 0) setSecondsLeft(totalSeconds);
    completionHandledRef.current = false;
    setIsRunning(true);
  }, [secondsLeft, totalSeconds]);

  const pause = useCallback(() => {
    setIsRunning(false);
  }, []);

  const reset = useCallback(() => {
    setIsRunning(false);
    setSecondsLeft(totalSeconds);
    completionHandledRef.current = false;
  }, [totalSeconds]);

  const skip = useCallback(() => {
    completionHandledRef.current = false;
    setSecondsLeft(0);
  }, []);

  const handleManualEdit = useCallback((newSeconds) => {
    const clamped = Math.max(0, Math.min(newSeconds, 24 * 60 * 60));
    setSecondsLeft(clamped);
  }, []);

  const handleAskFocusTip = useCallback(async () => {
    setAiLoading(true);
    try {
      const tip = await getAIFeedback({
        model,
        useLocalAI,
        context: { phase: "focus", focusMins, shortBreakMins, completedFocus },
        userQuestion: "Give me one concrete tip to stay focused for the next block.",
        defaultMessage: "Try the 3-2-1 launch: 3 deep breaths, 2 distractions removed, 1 clear goal.",
      });
      setAiMessage(tip);
      await maybeSpeak(tip, { openaiVoice, enableVoice, browserVoice });
    } catch (err) {
      console.error("Focus tip error:", err);
    } finally {
      setAiLoading(false);
    }
  }, [model, useLocalAI, focusMins, shortBreakMins, completedFocus, openaiVoice, enableVoice, browserVoice]);

  const handleSummaryProgress = useCallback(async () => {
    setAiLoading(true);
    try {
      const tip = await getAIFeedback({
        model,
        useLocalAI,
        context: { phase, focusMins, shortBreakMins, longBreakMins, completedFocus },
        userQuestion: "Summarize my productivity today in two sentences.",
        defaultMessage: `You've completed ${completedFocus} focus cycle(s). Keep the cadence; a short stretch and hydration before the next block will keep your energy steady.`,
      });
      setAiMessage(tip);
      await maybeSpeak(tip, { openaiVoice, enableVoice, browserVoice });
    } catch (err) {
      console.error("Summary error:", err);
    } finally {
      setAiLoading(false);
    }
  }, [model, useLocalAI, phase, focusMins, shortBreakMins, longBreakMins, completedFocus, openaiVoice, enableVoice, browserVoice]);

  const ringStyle = useMemo(() => {
    const p = Math.max(0, Math.min(100, 100 * (1 - secondsLeft / Math.max(1, totalSeconds))));
    return { background: `conic-gradient(rgb(79 70 229) ${p}%, rgb(31 41 55) ${p}% 100%)` };
  }, [secondsLeft, totalSeconds]);

  return (
    <div className="w">
      <div className="grid grid-2">
        <div className="card">
          <Header phase={phase} completedFocus={completedFocus} onOpenSettings={() => setShowSettings(true)} />

          {/* Progress ring */}
          <div className="center" style={{ marginTop: 24 }}>
            <div className="ring">
              <div className="ring" style={ringStyle} />
              <div className="ring-inner">
                {editMode ? (
                  <InlineEditor
                    seconds={secondsLeft}
                    onCancel={() => setEditMode(false)}
                    onSave={(secs) => { handleManualEdit(secs); setEditMode(false); }}
                  />
                ) : (
                  <div onClick={() => setEditMode(true)} style={{ cursor: "text", textAlign: "center", userSelect: "none" }}>
                    <div className="muted" style={{ letterSpacing: 2, textTransform: "uppercase", fontSize: 12 }}>
                      {phaseLabel(phase)}
                    </div>
                    <div style={{ marginTop: 8, fontWeight: 900, fontSize: 56 }}>
                      {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                    </div>
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>click time to edit</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
            {isRunning ? (
              <button className="btn btn-primary" onClick={pause}>Pause</button>
            ) : (
              <button className="btn btn-primary" onClick={start}>Start</button>
            )}
            <button className="btn" onClick={reset}>Reset</button>
            <button className="btn" onClick={skip}>Skip →</button>
            <button className={`btn ${phase === "focus" ? "btn-primary" : ""}`} onClick={() => setPhase("focus")}>
              Focus
            </button>
            <button className={`btn ${phase === "short" ? "btn-primary" : ""}`} onClick={() => setPhase("short")}>
              Short
            </button>
            <button className={`btn ${phase === "long" ? "btn-primary" : ""}`} onClick={() => setPhase("long")}>
              Long
            </button>
          </div>

          {/* Knobs */}
          <div style={{ marginTop: 24, display: "grid", gap: 16, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <Knob label="Focus (min)" value={focusMins} setValue={setFocusMins} min={1} max={120} />
            <Knob label="Short Break (min)" value={shortBreakMins} setValue={setShortBreakMins} min={1} max={60} />
            <Knob label="Long Break (min)" value={longBreakMins} setValue={setLongBreakMins} min={1} max={90} />
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }} className="subtle">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span>Long break every</span>
              <input
                className="input"
                type="number"
                min={1}
                max={10}
                value={cyclesUntilLong}
                onChange={(e) => setCyclesUntilLong(clampInt(e.target.value, 1, 10))}
                style={{ width: 70 }}
              />
              <span>focus cycles</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={useLocalAI} onChange={(e) => setUseLocalAI(e.target.checked)} />
                <span>Use Local AI</span>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={enableVoice} onChange={(e) => setEnableVoice(e.target.checked)} />
                <span>Voice</span>
              </label>
              <button className="btn" onClick={() => setShowSettings(true)}>Settings</button>
            </div>
          </div>
        </div>

        {/* Right: AI Coach */}
        <div className="card" style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ fontSize: 20, fontWeight: 700 }}>AI Coach</h2>
            <button className="btn" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => setAiOpen(v => !v)}>
              {aiOpen ? "Hide" : "Show"}
            </button>
          </div>

          {aiOpen && (
            <div style={{ marginTop: 16, flex: 1 }}>
              <div className="subtle" style={{ fontSize: 14 }}>Guidance appears here after each session.</div>
              <div className="card" style={{ marginTop: 12, minHeight: 140, whiteSpace: "pre-wrap", position: "relative" }}>
                {aiLoading && (
                  <div style={{ position: "absolute", top: 8, right: 8 }}>
                    <span className="subtle" style={{ fontSize: 12 }}>🤔 thinking...</span>
                  </div>
                )}
                {aiMessage || demoHint()}
              </div>

              <div style={{ marginTop: 16, display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <button className="btn btn-primary" onClick={handleAskFocusTip} disabled={aiLoading}>
                  Ask for a focus tip
                </button>
                <button className="btn" onClick={handleSummaryProgress} disabled={aiLoading}>
                  Summarize my progress
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Autoplay helper banner */}
      <div id="audioBanner" className="banner" style={{ display: "none" }}>
        <button className="btn btn-primary" onClick={() => {
          try {
            const u = new SpeechSynthesisUtterance("Audio enabled");
            window.speechSynthesis.cancel();
            window.speechSynthesis.speak(u);
          } catch {}
          document.getElementById("audioBanner")?.setAttribute("style", "display:none");
          localStorage.setItem("devtimer:audioPrimed", "1");
        }}>
          Enable Audio
        </button>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          model={model}
          setModel={setModel}
          openaiVoice={openaiVoice}
          setOpenaiVoice={setOpenaiVoice}
          browserVoice={browserVoice}
          setBrowserVoice={setBrowserVoice}
          browserVoices={browserVoices}
          enableVoice={enableVoice}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function Header({ phase, completedFocus, onOpenSettings }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <div>
        <h1 style={{ fontSize: 28, fontWeight: 900, letterSpacing: -0.5 }}>DevTimer</h1>
        <div className="muted" style={{ fontSize: 14 }}>Productivity + AI Coach</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className="badge">{phaseLabel(phase)}</span>
        <span className="badge" style={{ background: "rgba(245, 158, 11,.2)", borderColor: "rgba(245, 158, 11,.35)", color: "#fde68a" }}>
          {completedFocus} cycles
        </span>
        <button className="btn" onClick={onOpenSettings}>Settings</button>
      </div>
    </div>
  );
}

function Knob({ label, value, setValue, min = 1, max = 120 }) {
  return (
    <div className="card">
      <div className="subtle" style={{ fontSize: 14 }}>{label}</div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => setValue(clampInt(e.target.value, min, max))}
          style={{ width: "100%" }}
        />
        <input
          className="input"
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => setValue(clampInt(e.target.value, min, max))}
          style={{ width: 80 }}
        />
      </div>
    </div>
  );
}

function InlineEditor({ seconds, onSave, onCancel }) {
  const [mins, setMins] = useState(Math.floor(seconds / 60));
  const [secs, setSecs] = useState(seconds % 60);
  
  return (
    <div style={{ textAlign: "center" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
        <input
          className="input"
          type="number"
          value={mins}
          min={0}
          max={600}
          onChange={(e) => setMins(clampInt(e.target.value, 0, 600))}
          style={{ width: 80 }}
        />
        <span className="muted">:</span>
        <input
          className="input"
          type="number"
          value={secs}
          min={0}
          max={59}
          onChange={(e) => setSecs(clampInt(e.target.value, 0, 59))}
          style={{ width: 80 }}
        />
      </div>
      <div style={{ marginTop: 12, display: "flex", justifyContent: "center", gap: 8 }}>
        <button className="btn" onClick={() => onSave(mins * 60 + secs)}>Save</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function SettingsModal({ model, setModel, openaiVoice, setOpenaiVoice, browserVoice, setBrowserVoice, browserVoices, enableVoice, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        zIndex: 100,
        animation: "fadeIn 0.2s ease-out"
      }}
    >
      <div 
        className="card" 
        onClick={(e) => e.stopPropagation()} 
        style={{ 
          width: "100%", 
          maxWidth: 640,
          maxHeight: "90vh",
          overflowY: "auto",
          animation: "slideUp 0.3s ease-out"
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <div>
            <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>⚙️ Settings</h3>
            <p className="muted" style={{ fontSize: 13 }}>Configure your AI coach and voice preferences</p>
          </div>
          <button 
            className="btn" 
            onClick={onClose}
            style={{ 
              width: 40, 
              height: 40, 
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20
            }}
            title="Close"
          >
            ✕
          </button>
        </div>

        {/* Model Selection */}
        <div style={{ marginBottom: 24 }}>
          <label className="subtle" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, marginBottom: 8, fontWeight: 600 }}>
            🤖 AI Model
          </label>
          <select 
            className="input" 
            value={model} 
            onChange={(e) => setModel(e.target.value)}
            style={{ width: "100%", cursor: "pointer" }}
          >
            <option value="gpt-4o-mini">GPT-4o Mini (Recommended - Fast & Cost-effective)</option>
            <option value="gpt-4o">GPT-4o (More Capable)</option>
          </select>
        </div>

        {/* Voice Settings */}
        <div style={{ marginBottom: 24 }}>
          <label className="subtle" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
            🔊 Voice Settings
          </label>
          
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "1fr 1fr" }}>
            {/* OpenAI Voice */}
            <div>
              <label className="subtle" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
                OpenAI Voice (Primary)
              </label>
              <select 
                className="input" 
                value={openaiVoice} 
                onChange={(e) => setOpenaiVoice(e.target.value)}
                style={{ width: "100%", cursor: "pointer" }}
              >
                <option value="aria">👩 Aria (Female)</option>
                <option value="alloy">🧑 Alloy (Neutral)</option>
                <option value="verse">👨 Verse (Male)</option>
              </select>
            </div>

            {/* Browser Voice */}
            <div>
              <label className="subtle" style={{ display: "block", fontSize: 13, marginBottom: 6 }}>
                Browser Voice (Fallback)
              </label>
              <select 
                className="input" 
                value={browserVoice} 
                onChange={(e) => setBrowserVoice(e.target.value)}
                style={{ 
                  width: "100%", 
                  cursor: "pointer",
                  fontSize: 12,
                  paddingRight: 30
                }}
              >
                {browserVoices.length === 0 && <option value="">(No voices available)</option>}
                {browserVoices.map(v => (
                  <option key={v.name} value={v.name}>
                    {v.name.length > 35 ? v.name.substring(0, 35) + "..." : v.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Test Buttons */}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              className="btn"
              style={{ flex: 1 }}
              onClick={() => maybeSpeak("This is a voice test using OpenAI.", { openaiVoice, enableVoice, browserVoice })}
            >
              🎵 Test OpenAI
            </button>
            <button 
              className="btn" 
              style={{ flex: 1 }}
              onClick={() => speakWebSpeech("This is a browser voice test.", browserVoice)}
            >
              🔈 Test Browser
            </button>
          </div>
        </div>

        {/* Info Card */}
        <div 
          className="card" 
          style={{ 
            fontSize: 13, 
            background: "rgba(99, 102, 241, 0.1)",
            borderColor: "rgba(129, 140, 248, 0.2)"
          }}
        >
          <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
            <span style={{ fontSize: 20 }}>ℹ️</span>
            <div>
              <p style={{ fontWeight: 600, marginBottom: 6, color: "rgba(255,255,255,0.9)" }}>
                Secure Backend Configuration
              </p>
              <p className="subtle" style={{ lineHeight: 1.5 }}>
                Your app uses server endpoints <code style={{ 
                  background: "rgba(255,255,255,0.1)", 
                  padding: "2px 6px", 
                  borderRadius: 4,
                  fontSize: 12
                }}>/api/ai</code> and <code style={{ 
                  background: "rgba(255,255,255,0.1)", 
                  padding: "2px 6px", 
                  borderRadius: 4,
                  fontSize: 12
                }}>/api/tts</code> to keep your OpenAI API key secure on the server.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-primary" onClick={onClose} style={{ minWidth: 100 }}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function phaseLabel(p) {
  if (p === "focus") return "Focus";
  if (p === "short") return "Short Break";
  return "Long Break";
}

function clampInt(v, min, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function getLS(key, fallback) {
  try {
    const raw = localStorage.getItem(`devtimer:${key}`);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setLS(key, value) {
  try {
    localStorage.setItem(`devtimer:${key}`, JSON.stringify(value));
  } catch (err) {
    console.warn("localStorage error:", err);
  }
}

function demoHint() {
  return "➡️ Set Focus (min) to 1 and press Start. On completion, the AI Coach suggests a stretch and SPEAKS it if Voice is on.";
}

// ---------- AI + Voice ----------

async function getAIFeedback({ model, useLocalAI, context, userQuestion, defaultMessage }) {
  const basePrompt =
    `You are a concise, encouraging productivity coach.\n` +
    `Context: ${JSON.stringify(context)}\n` +
    `Instruction: If the user just finished a focus block, suggest a short, body-friendly break and one small setup action for the next sprint. Keep it under 280 characters.`;
  const prompt = userQuestion ? `${basePrompt}\nUser request: ${userQuestion}` : basePrompt;

  // Demo special line for testing
  if (context?.phase === "focus" && context?.focusMins === 1 && !userQuestion) {
    return "Great 1-min test! Take a quick stretch. Roll your shoulders, look away from the screen. When you're back, you're ready for a real focus session.";
  }

  if (useLocalAI) return localCoach(context, !!userQuestion, defaultMessage);

  try {
    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || DEFAULT_MODEL, prompt })
    });
    
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      console.error("AI API error:", r.status, errText);
      throw new Error(`AI HTTP ${r.status}`);
    }
    
    const data = await r.json();
    const text = data?.text || defaultMessage;
    return text || defaultMessage;
  } catch (err) {
    console.error("AI feedback failed:", err);
    return defaultMessage;
  }
}

function localCoach(ctx, hasQuestion, fallback) {
  if (hasQuestion) {
    const tips = [
      "Set one 25-min goal and close all tabs not needed.",
      "Silence notifications and enable do-not-disturb.",
      "Write a 3-bullet plan, then start with bullet #1.",
      "Use headphones with a single playlist for focus.",
      "Stand up, breathe 3 times, then commit to 10 solid minutes.",
    ];
    return tips[Math.floor(Math.random() * tips.length)];
  }
  
  if (ctx?.phase === "focus") {
    return `Great work! You finished a ${ctx.focusMins}-minute focus block. Take a ${ctx.shortBreakMins}-minute stretch and hydrate. Prep 1 small next step for a smooth restart.`;
  }
  
  return fallback || "Keep your momentum: short stretch, then ease back into your next focus sprint.";
}

async function maybeSpeak(text, { openaiVoice, enableVoice, browserVoice }) {
  if (!enableVoice || !text) return;
  
  // Try OpenAI (server proxy) first
  try {
    await speakOpenAI(text, openaiVoice);
    return;
  } catch (e) {
    console.warn("[Voice] OpenAI TTS failed, falling back to Web Speech:", e?.message || e);
  }
  
  // Fallback to Web Speech
  try {
    speakWebSpeech(text, browserVoice);
  } catch (e) {
    console.error("[Voice] Web Speech failed:", e);
  }
}

async function speakOpenAI(text, voice = "alloy") {
  let r;
  try {
    r = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice })
    });
  } catch (e) {
    throw new Error("Network error");
  }
  
  if (!r.ok) {
    const err = await safeReadText(r);
    throw new Error(`TTS ${r.status}: ${err}`);
  }
  
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  
  // Track for cleanup
  if (window.__devtimerAudio) {
    try {
      window.__devtimerAudio.pause();
      URL.revokeObjectURL(window.__devtimerAudio.src);
    } catch {}
  }
  window.__devtimerAudio = audio;
  
  try {
    await audio.play();
  } catch {
    // Show tap to play
    showTapToPlay(url);
    return;
  }
  
  audio.onended = () => {
    URL.revokeObjectURL(url);
    if (window.__devtimerAudio === audio) {
      window.__devtimerAudio = null;
    }
  };

  // Prime autoplay for next time
  localStorage.setItem("devtimer:audioPrimed", "1");
}

function speakWebSpeech(text, voiceName) {
  if (!("speechSynthesis" in window)) return;
  
  const utter = new SpeechSynthesisUtterance(text);
  const voices = window.speechSynthesis.getVoices();
  
  if (voiceName) {
    const match = voices.find(v => v.name.toLowerCase() === voiceName.toLowerCase());
    if (match) utter.voice = match;
  }
  
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;
  
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utter);
}

function showTapToPlay(url) {
  const id = "devtimer-tap";
  if (document.getElementById(id)) return;
  
  const chip = document.createElement("button");
  chip.id = id;
  chip.textContent = "🔊 Tap to Play";
  chip.className = "chip";
  document.body.appendChild(chip);

  chip.onclick = () => {
    const audio = new Audio(url);
    audio.play().catch(err => console.error("[TTS] Play failed:", err));
    audio.onended = () => {
      URL.revokeObjectURL(url);
      chip.remove();
    };
  };
}

async function safeReadText(res) {
  try {
    return await res.text();
  } catch {
    return "<no text>";
  }
}

// Show audio-enable banner if needed
setTimeout(() => {
  try {
    const primed = localStorage.getItem("devtimer:audioPrimed") === "1";
    if (!primed) {
      const el = document.getElementById("audioBanner");
      if (el) el.style.display = "block";
    }
  } catch {}
}, 200);

// --------- Mount ---------
const root = createRoot(document.getElementById("root"));
root.render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);