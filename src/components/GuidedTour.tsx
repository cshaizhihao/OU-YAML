import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, ChevronLeft, ChevronRight, CircleHelp, Clock3, Compass, GraduationCap, ListChecks, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { Drawer } from "./Dialog";
import { findGuide, GUIDE_VERSION, guideRegistry, guideTargets, type GuideDefinition, type GuideView } from "../guides/registry";

type ActiveGuide = { guideId: string; stepIndex: number };
type StoredGuideState = { version: string; completed: string[]; resume?: ActiveGuide };

export type GuideController = {
  active: ActiveGuide | null;
  completed: string[];
  resume: ActiveGuide | null;
  welcomeOpen: boolean;
  centerOpen: boolean;
  start: (guideId: string, stepIndex?: number) => void;
  next: () => void;
  previous: () => void;
  pause: () => void;
  finish: () => void;
  skipWelcome: () => void;
  openCenter: () => void;
  closeCenter: () => void;
};

function stateKey(username: string) {
  return `ou-yaml:guide:${username}`;
}

function readGuideState(username: string): StoredGuideState | null {
  try {
    const value = localStorage.getItem(stateKey(username));
    if (!value) return null;
    const parsed = JSON.parse(value) as Partial<StoredGuideState>;
    return {
      version: typeof parsed.version === "string" ? parsed.version : "",
      completed: Array.isArray(parsed.completed) ? parsed.completed.filter((item): item is string => typeof item === "string") : [],
      resume: parsed.resume && typeof parsed.resume.guideId === "string" && Number.isInteger(parsed.resume.stepIndex) ? parsed.resume : undefined,
    };
  } catch {
    return null;
  }
}

export function useGuideController(username: string): GuideController {
  const initial = useMemo(() => readGuideState(username), [username]);
  const [storedVersion, setStoredVersion] = useState(initial?.version || "");
  const [completed, setCompleted] = useState<string[]>(initial?.completed || []);
  const [resume, setResume] = useState<ActiveGuide | null>(initial?.version === GUIDE_VERSION ? initial.resume || null : null);
  const [active, setActive] = useState<ActiveGuide | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(!initial || initial.version !== GUIDE_VERSION);
  const [centerOpen, setCenterOpen] = useState(false);

  useEffect(() => {
    const stored: StoredGuideState = { version: storedVersion, completed, resume: active || resume || undefined };
    localStorage.setItem(stateKey(username), JSON.stringify(stored));
  }, [active, completed, resume, storedVersion, username]);

  const start = useCallback((guideId: string, stepIndex = 0) => {
    const guide = findGuide(guideId);
    if (!guide) return;
    const next = { guideId, stepIndex: Math.min(Math.max(stepIndex, 0), guide.steps.length - 1) };
    setActive(next);
    setResume(next);
    setStoredVersion(GUIDE_VERSION);
    setWelcomeOpen(false);
    setCenterOpen(false);
  }, []);

  const finish = useCallback(() => {
    if (active) setCompleted((current) => current.includes(active.guideId) ? current : [...current, active.guideId]);
    setActive(null);
    setResume(null);
  }, [active]);

  const next = useCallback(() => {
    if (!active) return;
    const guide = findGuide(active.guideId);
    if (!guide || active.stepIndex >= guide.steps.length - 1) {
      finish();
      return;
    }
    const value = { ...active, stepIndex: active.stepIndex + 1 };
    setActive(value);
    setResume(value);
  }, [active, finish]);

  const previous = useCallback(() => {
    if (!active || active.stepIndex === 0) return;
    const value = { ...active, stepIndex: active.stepIndex - 1 };
    setActive(value);
    setResume(value);
  }, [active]);

  const pause = useCallback(() => {
    if (active) setResume(active);
    setActive(null);
  }, [active]);

  const skipWelcome = useCallback(() => {
    setStoredVersion(GUIDE_VERSION);
    setWelcomeOpen(false);
    setResume(null);
  }, []);

  return {
    active,
    completed,
    resume,
    welcomeOpen,
    centerOpen,
    start,
    next,
    previous,
    pause,
    finish,
    skipWelcome,
    openCenter: () => setCenterOpen(true),
    closeCenter: () => setCenterOpen(false),
  };
}

type TargetRect = { top: number; left: number; width: number; height: number };

function GuidedPopover({ controller, currentView, navigate }: { controller: GuideController; currentView: GuideView; navigate: (view: GuideView) => void }) {
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const activeGuide = controller.active ? findGuide(controller.active.guideId) : undefined;
  const step = activeGuide && controller.active ? activeGuide.steps[controller.active.stepIndex] : undefined;

  useEffect(() => {
    if (!step || step.view === currentView) return;
    navigate(step.view);
  }, [currentView, navigate, step]);

  useEffect(() => {
    setTargetRect(null);
    if (!step || step.view !== currentView) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let target: HTMLElement | null = null;
    const readRect = () => {
      if (!target || !document.documentElement.contains(target)) return setTargetRect(null);
      const rect = target.getBoundingClientRect();
      setTargetRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };
    const find = () => {
      if (cancelled) return;
      target = document.querySelector<HTMLElement>(`[data-guide-id="${step.target}"]`);
      if (!target && attempts < 25) {
        attempts += 1;
        window.setTimeout(find, 100);
        return;
      }
      if (!target) return setTargetRect(null);
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      window.setTimeout(readRect, 280);
      readRect();
    };
    find();
    window.addEventListener("resize", readRect);
    window.addEventListener("scroll", readRect, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", readRect);
      window.removeEventListener("scroll", readRect, true);
    };
  }, [currentView, step]);

  useEffect(() => {
    if (!step) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") controller.pause();
      if (event.key === "ArrowRight") controller.next();
      if (event.key === "ArrowLeft") controller.previous();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [controller, step]);

  if (!activeGuide || !step || !controller.active) return null;
  const margin = 8;
  const popoverWidth = Math.min(390, Math.max(280, window.innerWidth - 24));
  const estimatedHeight = 250;
  const popoverStyle = targetRect ? {
    width: popoverWidth,
    left: Math.min(Math.max(12, targetRect.left + targetRect.width / 2 - popoverWidth / 2), window.innerWidth - popoverWidth - 12),
    top: targetRect.top + targetRect.height + estimatedHeight + 24 < window.innerHeight
      ? targetRect.top + targetRect.height + 18
      : Math.max(12, targetRect.top - estimatedHeight - 18),
  } : { width: popoverWidth, left: Math.max(12, (window.innerWidth - popoverWidth) / 2), top: Math.max(80, (window.innerHeight - estimatedHeight) / 2) };

  return <div className="guided-tour-layer" aria-live="polite">
    {targetRect && <div className="guided-tour-highlight" style={{ top: targetRect.top - margin, left: targetRect.left - margin, width: targetRect.width + margin * 2, height: targetRect.height + margin * 2 }} />}
    <section className="guided-tour-popover" style={popoverStyle} role="dialog" aria-label={`${activeGuide.title}：${step.title}`}>
      <header>
        <span><Compass size={15} />{activeGuide.title}</span>
        <button className="icon-button compact" onClick={controller.pause} aria-label="暂停教程"><X size={17} /></button>
      </header>
      <div className="guided-tour-progress"><i style={{ width: `${((controller.active.stepIndex + 1) / activeGuide.steps.length) * 100}%` }} /></div>
      <div className="guided-tour-body">
        <small>第 {controller.active.stepIndex + 1} / {activeGuide.steps.length} 步</small>
        <h2>{step.title}</h2>
        <p>{step.description}</p>
        {step.tip && <div className="guided-tour-tip"><Sparkles size={15} />{step.tip}</div>}
        {!targetRect && <div className="guided-tour-wait">正在打开对应页面并定位操作区域……</div>}
      </div>
      <footer>
        <button className="secondary-button compact-button" disabled={controller.active.stepIndex === 0} onClick={controller.previous}><ChevronLeft size={15} />上一步</button>
        <button className="primary-button compact-button" onClick={controller.next}>{controller.active.stepIndex === activeGuide.steps.length - 1 ? "完成教程" : "下一步"}{controller.active.stepIndex < activeGuide.steps.length - 1 && <ChevronRight size={15} />}</button>
      </footer>
    </section>
  </div>;
}

function WelcomeGuide({ controller, username }: { controller: GuideController; username: string }) {
  if (!controller.welcomeOpen) return null;
  return <div className="guide-welcome-overlay" role="presentation">
    <section className="guide-welcome" role="dialog" aria-modal="true" aria-labelledby="guide-welcome-title">
      <div className="guide-welcome-art"><span><GraduationCap size={29} /></span><i /><i /><i /></div>
      <span className="eyebrow">OU-YAML · 新手模式</span>
      <h1 id="guide-welcome-title">欢迎回来，{username}</h1>
      <p>不需要会写 YAML。跟随引导依次完成导入、选择、代理设置、中文分流和发布订阅。</p>
      <div className="guide-welcome-features">
        <span><ListChecks size={18} /><strong>自动跳转</strong><small>每一步都会打开正确页面</small></span>
        <span><BookOpenCheck size={18} /><strong>中文解释</strong><small>英文规则保留为标准输出</small></span>
        <span><Clock3 size={18} /><strong>随时继续</strong><small>退出后会记住当前进度</small></span>
      </div>
      <div className="guide-welcome-actions">
        <button className="text-button" onClick={controller.skipWelcome}>暂时跳过</button>
        <button className="primary-button" onClick={() => controller.start("quickstart")}><Play size={17} />开始 5 分钟教程</button>
      </div>
    </section>
  </div>;
}

function GuideCard({ guide, completed, resume, onStart }: { guide: GuideDefinition; completed: boolean; resume?: ActiveGuide; onStart: (step?: number) => void }) {
  const isResume = resume?.guideId === guide.id;
  return <article className={`guide-library-card${completed ? " complete" : ""}`}>
    <span className="guide-library-icon">{completed ? <BookOpenCheck size={19} /> : <GraduationCap size={19} />}</span>
    <div><h3>{guide.title}</h3><p>{guide.description}</p><small><Clock3 size={13} />{guide.duration} · {guide.steps.length} 步</small></div>
    <button className={isResume ? "primary-button compact-button" : "secondary-button compact-button"} onClick={() => onStart(isResume ? resume.stepIndex : 0)}>{isResume ? <Play size={14} /> : completed ? <RotateCcw size={14} /> : <Play size={14} />}{isResume ? "继续" : completed ? "重看" : "开始"}</button>
  </article>;
}

export function GuideExperience({ controller, username, currentView, navigate }: { controller: GuideController; username: string; currentView: GuideView; navigate: (view: GuideView) => void }) {
  return <>
    <button className="floating-help-button" data-guide-id={guideTargets.helpButton} onClick={controller.openCenter} aria-label="打开新手教程"><CircleHelp size={20} /><span>新手教程</span></button>
    <WelcomeGuide controller={controller} username={username} />
    <GuidedPopover controller={controller} currentView={currentView} navigate={navigate} />
    <Drawer title="新手教程与帮助" open={controller.centerOpen} onClose={controller.closeCenter}>
      <div className="guide-library-intro"><span><Compass size={22} /></span><div><strong>从当前进度继续，或学习单项功能</strong><p>教程会自动跳转并高亮对应操作，不会修改你的配置。</p></div></div>
      <div className="guide-library-list">{guideRegistry.map((guide) => <GuideCard key={guide.id} guide={guide} completed={controller.completed.includes(guide.id)} resume={controller.resume || undefined} onStart={(step) => controller.start(guide.id, step)} />)}</div>
      <div className="guide-maintenance-note"><Sparkles size={16} /><span><strong>教程版本 {GUIDE_VERSION}</strong><small>后续功能更新时，新步骤会随版本提示同步出现。</small></span></div>
    </Drawer>
  </>;
}
