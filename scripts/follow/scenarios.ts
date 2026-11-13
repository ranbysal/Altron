// Run with: npx tsx scripts/follow/scenarios.ts  (synthetic price paths through the follow engine)
import { run } from "./sim";
const E = 20000;
// 1. runs straight his way fast: go now; TP1 then TP2
run("runner", { his: { targets: [E + 150, E + 300] }, secs: 1800, path: (t) => (t < 60 ? E + t * 0.6 : t < 900 ? E + 36 + (t - 60) * 0.15 : E + 160 + (t - 900) * 0.2) });
// 2. drifts against him a little, then works: better-price limit fills
run("pullback", { his: { targets: [E + 150, E + 300] }, secs: 2400, path: (t) => (t < 90 ? E - t * 0.12 : E - 10.8 + (t - 90) * 0.15) });
// 3. falls hard and keeps falling: pass at the window
run("failing", { his: { targets: [E + 150] }, secs: 300, path: (t) => E - t * 0.4 });
// 4. already most of the way to target when we look: pass on R:R
run("too late", { his: { targets: [E + 60] }, secs: 200, path: (t) => E + Math.min(50, t * 2) });
// 5. we're in, it reverses to our stop
run("stopped", { his: { targets: [E + 150] }, secs: 1200, path: (t) => (t < 40 ? E + t * 0.6 : E + 24 - (t - 40) * 0.2) });
// 6. he closes while we're in: we follow him out
run("his exit", { his: { targets: [E + 300], closeAt: 600 }, secs: 700, path: (t) => (t < 40 ? E + t * 0.6 : E + 24 + Math.sin(t / 30) * 5) });
// 7. owner closes by hand; agent must not re-enter
run("by hand", { his: { targets: [E + 300] }, secs: 400, manualCloseAt: 100, path: (t) => (t < 40 ? E + t * 0.6 : E + 24) });
// 8. near the stop line: room too thin -> pass; and a loss that crosses the line -> halt
run("thin room", { his: { targets: [E + 300] }, secs: 200, balance: 150000 - 3300, path: (t) => E + t * 0.6 });
run("stop line", { his: { targets: [E + 300] }, secs: 1200, balance: 150000 - 2600, limits: { risk: { eval: 0.9, buffer: 0.9, built: 0.9 } }, path: (t) => (t < 40 ? E + t * 0.6 : E + 24 - (t - 40) * 0.5) });
// 9. short, one target, funded and buffer built with 1 micro + two targets
run("short", { his: { dir: -1, targets: [E - 150, E - 300] }, secs: 1800, path: (t) => (t < 60 ? E - t * 0.6 : E - 36 - (t - 60) * 0.18) });
// 10. AI: says limit, then enter_now; later tighten (valid) and a bad widen
run("ai", { his: { targets: [E + 200] }, secs: 600, path: (t) => (t < 30 ? E - t * 0.1 : E - 3 + (t - 30) * 0.12), advice: (t, asks) => {
  const k = asks[0].kind;
  if (k === "entry") return t < 10 ? { kind: "entry", action: "limit", price: E - 4, reason: "Small pullback likely" } : { kind: "entry", action: "enter_now", reason: "It's turning his way" };
  return t < 200 ? { kind: "manage", action: "tighten", price: E - 200, reason: "bad: widen" } : { kind: "manage", action: "tighten", price: E + 20, reason: "Lock some in" };
} });
// 11. following paused
run("paused", { his: { targets: [E + 300] }, secs: 30, following: false, path: () => E });
