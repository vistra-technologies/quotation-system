"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import brand from "@/components/brand/brand.module.css";
import { BrandLogo } from "@/components/brand/brand-logo";
import s from "./login-scene.module.css";

interface LoginSceneProps {
  /** Password field is focused and masked — turns the glass opaque + shows the chip. */
  privacyGlass: boolean;
  /** Sign-in request in flight — panes slide together into one partition. */
  submitting: boolean;
}

const PANES = [
  { id: "P-01", spec: "10 mm toughened · 1200 × 2700" },
  { id: "P-02", spec: "Acoustic laminated · 1200 × 2700" },
  { id: "P-03", spec: "12 mm toughened · 1200 × 2700" },
  { id: "D-01", spec: "Hinged glass door · 1200 × 2700", door: true },
  { id: "P-04", spec: "Switchable privacy · 1200 × 2700" },
];

const FLOW = ["Inquiry", "Project", "Quote ready"];
const QUOTE_TOTAL = 48250;
const BAR_HEIGHTS = [45, 70, 55, 90, 100];
const STAGE_MS = 3600;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

// Server snapshot is `false`; the client value is picked up after hydration
// without a mismatch.
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * Animated "glass partition" scene beside the sign-in form (Stage 28 B1, S28-9).
 *
 * Ported from design-docs/mockups/login-page-poc.html. The mockup's script runs
 * in one effect here; every listener, timer and rAF it starts is torn down in
 * the cleanup (and a `disposed` flag makes late callbacks no-ops). Under
 * `prefers-reduced-motion` there is no pointer-parallax loop, no autoplay and
 * no sparkles — the default stage stays on screen and the flow tabs stay
 * clickable.
 */
export function LoginScene({ privacyGlass, submitting }: LoginSceneProps) {
  const reduced = useReducedMotion();

  const sceneRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const stageScaleRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const sparklesRef = useRef<HTMLDivElement>(null);

  const [intro, setIntro] = useState(true);
  const [settling, setSettling] = useState(true);
  const [lifted, setLifted] = useState<number | null>(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [quoteVal, setQuoteVal] = useState(QUOTE_TOTAL);
  const [barsUp, setBarsUp] = useState(0);

  // While submitting the scene is parked on the final "Quote ready" stage.
  const activeStage = submitting ? 2 : stageIdx;
  const privacy = privacyGlass && !submitting;
  const liftedPane = submitting ? null : lifted;

  // ---- intro: panes fly in one by one ----
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setIntro(false));
    });
    const settle = setTimeout(() => setSettling(false), 1800);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(settle);
    };
  }, []);

  // ---- sparkles, stage fit, pointer parallax + drag-to-turn ----
  useEffect(() => {
    const scene = sceneRef.current;
    const stage = stageRef.current;
    const stageScale = stageScaleRef.current;
    const world = worldRef.current;
    const sparkles = sparklesRef.current;
    if (!scene || !stage || !stageScale || !world || !sparkles) return;

    let disposed = false;
    let raf = 0;

    // Sparkles use Math.random(), so they are created here (client only) and
    // never in render — no hydration mismatch.
    if (!reduced) {
      for (let i = 0; i < 16; i++) {
        const sp = document.createElement("i");
        sp.style.left = 8 + Math.random() * 84 + "%";
        sp.style.top = 30 + Math.random() * 60 + "%";
        sp.style.setProperty("--sz", (3 + Math.random() * 5).toFixed(1) + "px");
        sp.style.setProperty("--dur", (6 + Math.random() * 7).toFixed(1) + "s");
        sp.style.setProperty("--delay", (-Math.random() * 10).toFixed(1) + "s");
        sparkles.appendChild(sp);
      }
    }

    // fit the 3D stage to the available space
    function fit() {
      if (disposed || !stage || !stageScale) return;
      const r = stage.getBoundingClientRect();
      const k = Math.max(0.45, Math.min(1.05, r.width / 900, r.height / 470));
      stageScale.style.setProperty("--s", k.toFixed(3));
    }
    fit();
    window.addEventListener("resize", fit);

    // pointer parallax (whole window) + drag to turn
    let tx = 0;
    let ty = 0;
    let cx_ = 0;
    let cy = 0;
    let drag = 0;
    let dragging = false;
    let lastX = 0;
    const layers = [...scene.querySelectorAll<HTMLElement>("[data-depth]")];

    function onPointerMove(e: PointerEvent) {
      if (disposed || !scene) return;
      tx = (e.clientX / window.innerWidth - 0.5) * 2;
      ty = (e.clientY / window.innerHeight - 0.5) * 2;
      const r = scene.getBoundingClientRect();
      scene.style.setProperty("--mx", e.clientX - r.left + "px");
      scene.style.setProperty("--my", e.clientY - r.top + "px");
      if (dragging) {
        drag = Math.max(-55, Math.min(55, drag + (e.clientX - lastX) * 0.3));
        lastX = e.clientX;
      }
    }
    function onPointerDown(e: PointerEvent) {
      if (e.pointerType === "touch" || !stage) return; // keep page scroll on touch
      dragging = true;
      lastX = e.clientX;
      stage.setAttribute("data-dragging", "");
    }
    function onPointerUp() {
      dragging = false;
      stage?.removeAttribute("data-dragging");
    }

    function loop() {
      if (disposed || !scene || !world) return;
      cx_ += (tx - cx_) * 0.06;
      cy += (ty - cy) * 0.06;
      if (!dragging) drag *= 0.94; // spring back
      const ry = -30 + cx_ * 12 + drag;
      const rx = 14 - cy * 6;
      world.style.transform =
        "rotateX(" + rx.toFixed(2) + "deg) rotateY(" + ry.toFixed(2) + "deg)";
      world.style.setProperty("--g", (40 + cx_ * 34 + drag * 0.7).toFixed(1));
      scene.style.setProperty("--px", cx_.toFixed(3));
      scene.style.setProperty("--py", cy.toFixed(3));
      layers.forEach((el) => {
        const d = parseFloat(el.dataset.depth ?? "1");
        el.style.transform =
          "translate3d(" +
          (-cx_ * d * 18).toFixed(1) +
          "px," +
          (-cy * d * 12).toFixed(1) +
          "px,0)";
      });
      raf = requestAnimationFrame(loop);
    }

    if (!reduced) {
      window.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("pointerup", onPointerUp);
      raf = requestAnimationFrame(loop);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      sparkles.replaceChildren();
      // Leave the parallax layers + world transform clean for the next run.
      layers.forEach((el) => {
        el.style.transform = "";
      });
      world.style.transform = "";
    };
  }, [reduced]);

  // ---- workflow autoplay: Inquiry -> Project -> Quote ready ----
  // Re-arms on every stage change, so clicking a tab also restarts the clock.
  useEffect(() => {
    if (reduced || submitting) return;
    const t = setTimeout(() => setStageIdx((i) => (i + 1) % FLOW.length), STAGE_MS);
    return () => clearTimeout(t);
  }, [stageIdx, reduced, submitting]);

  // ---- "Quote ready" stage: count the total up and raise the bars ----
  useEffect(() => {
    if (activeStage !== 2) return;
    let raf = 0;
    let disposed = false;
    const t0 = performance.now();
    const dur = 1100;
    function tick(t: number) {
      if (disposed) return;
      const k = Math.max(0, Math.min(1, (t - t0) / dur));
      const e = 1 - Math.pow(1 - k, 3);
      setQuoteVal(Math.round(QUOTE_TOTAL * e));
      if (k < 1) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    const timers = BAR_HEIGHTS.map((_, n) =>
      setTimeout(() => {
        if (!disposed) setBarsUp(n + 1);
      }, n * 90),
    );
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
      setBarsUp(0);
    };
  }, [activeStage]);

  function chipCls(extra: string, stage: number) {
    return cx(s.chip, extra, activeStage === stage && s.active);
  }

  return (
    <section
      ref={sceneRef}
      className={cx(brand.sceneTokens, s.scene)}
      aria-label="EaseeTool — glass partition estimation"
    >
      <div className={s.sceneCopy}>
        <BrandLogo tone="onDark" className={s.sceneBrand} />
        <div className={s.sceneEyebrow}>EaseeTool · Estimation platform</div>
        <h1>
          Estimation, engineered for <em>glass partition</em> systems.
        </h1>
        <p>
          From the first inquiry to a priced quotation — configure every pane,
          profile and door, and quote with confidence.
        </p>
      </div>

      <div ref={sparklesRef} className={s.sparkles} data-depth="1.6" aria-hidden="true" />

      <div className={s.sceneBody}>
        <div ref={stageRef} className={s.stage} aria-hidden="true">
          <div ref={stageScaleRef} className={s.stageScale}>
            <div className={s.worldFloat}>
              <div
                ref={worldRef}
                className={cx(
                  s.world,
                  intro && s.intro,
                  settling && s.settling,
                  privacy && s.privacy,
                  submitting && s.assembled,
                )}
              >
                <div className={s.floor} />
                <div className={cx(s.dim, s.dimH)}>
                  <span>RUN · 6 000 MM</span>
                </div>
                <div className={cx(s.dim, s.dimV)}>
                  <span>2 700 MM</span>
                </div>
                <div className={cx(s.rail, s.railTop)} />

                {PANES.map((p, i) => (
                  <div
                    key={p.id}
                    className={cx(s.pane, liftedPane === i && s.lift)}
                    style={{ "--i": i } as CSSProperties}
                    onClick={() => setLifted((cur) => (cur === i ? null : i))}
                  >
                    {p.door && (
                      <>
                        <div className={cx(s.hinge, s.hingeTop)} />
                        <div className={cx(s.hinge, s.hingeBottom)} />
                        <div className={s.handle} />
                      </>
                    )}
                    <div className={s.manifest} />
                    <div className={s.paneTag}>
                      <b>{p.id}</b>
                      {p.spec}
                    </div>
                  </div>
                ))}

                <div className={cx(s.rail, s.railBottom)} />
              </div>
            </div>
          </div>
        </div>

        {/* floating status chips — one per workflow stage */}
        <div className={chipCls(s.chipInquiry, 0)} data-depth="1.2" aria-hidden="true">
          <div className={s.chipIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z" />
            </svg>
          </div>
          <div>
            <div className={s.chipLabel}>New inquiry</div>
            <div className={s.chipValue}>
              INQ-1042 <small>· Dubai Downtown</small>
            </div>
          </div>
          <span className={s.pulse} />
        </div>

        <div className={chipCls(s.chipProject, 1)} data-depth="0.8" aria-hidden="true">
          <div className={s.chipIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
          </div>
          <div>
            <div className={s.chipLabel}>Project created</div>
            <div className={s.chipValue}>
              PRJ-318 <small>· 5 panes, 1 door</small>
            </div>
          </div>
        </div>

        <div className={chipCls(s.chipQuote, 2)} data-depth="1.5" aria-hidden="true">
          <div className={s.chipIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13h6M9 17h4" />
            </svg>
          </div>
          <div>
            <div className={s.chipLabel}>Quote ready</div>
            <div className={s.chipValue}>
              AED <span>{quoteVal.toLocaleString("en-US")}</span>
            </div>
          </div>
          <div className={s.quoteBars}>
            {BAR_HEIGHTS.map((h, n) => (
              <i key={n} style={{ height: barsUp > n ? h + "%" : "30%" }} />
            ))}
          </div>
        </div>

        <div className={cx(s.chip, s.chipPrivacy, privacy && s.show)} aria-hidden="true">
          <div className={s.chipIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <span>Privacy glass engaged</span>
        </div>
      </div>

      <div className={s.sceneFoot}>
        <div className={s.flow} role="tablist" aria-label="Workflow">
          {FLOW.map((label, n) => (
            <FlowStep
              key={label}
              n={n}
              label={label}
              active={activeStage === n}
              filled={n <= activeStage}
              onSelect={() => setStageIdx(n)}
            />
          ))}
        </div>
        <div className={s.hint}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 11V6a2 2 0 0 0-4 0v5" />
            <path d="M14 10V4a2 2 0 0 0-4 0v2" />
            <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
            <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
          </svg>
          Drag to turn the partition · hover a pane
        </div>
      </div>
    </section>
  );
}

/** One workflow tab, plus the connector line that precedes it (all but the first;
 *  the line fills once its step is reached — `filled`). */
function FlowStep({
  n,
  label,
  active,
  filled,
  onSelect,
}: {
  n: number;
  label: string;
  active: boolean;
  filled: boolean;
  onSelect: () => void;
}) {
  return (
    <>
      {n > 0 && <span className={cx(s.flowLink, filled && s.fill)} />}
      <button
        type="button"
        role="tab"
        aria-selected={active}
        className={cx(s.flowStep, active && s.active)}
        onClick={onSelect}
      >
        <b>{String(n + 1).padStart(2, "0")}</b>
        {label}
      </button>
    </>
  );
}
