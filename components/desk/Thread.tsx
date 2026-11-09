"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useShallow } from "zustand/react/shallow";
import { fmt, money } from "@/lib/format";
import { INSTRUMENTS } from "@/lib/desk/instruments";
import { editNote, postNote, setThread, useDesk, type Note, type Phase, type Trade } from "@/lib/desk/store";
import s from "./desk.module.css";

const PHASE: Record<Phase, string> = { before: "Before entry", during: "In the trade", after: "After exit" };
const RECENT_MS = 45 * 60_000;

function clock(t: number, secs = false): string {
  return new Date(t).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", ...(secs ? { second: "2-digit" } : {}) });
}

function tradeLabel(t: Trade): string {
  return `${INSTRUMENTS[t.sym].code} ${t.side.toLowerCase()} ${t.qty}`;
}

function Message({ n, i }: { n: Note; i: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(n.text);
  const [showOld, setShowOld] = useState(false);
  return (
    <li className={s.msg} style={{ "--k": i } as CSSProperties}>
      <div className={s.msgMeta}>
        <span className={`${s.phase} ${s[`phase_${n.phase}`]}`}>{PHASE[n.phase]}</span>
        <time title={new Date(n.at).toLocaleString("en-US", { timeZone: "America/New_York" })}>{clock(n.at, true)}</time>
        {n.edits.length > 0 && (
          <button type="button" className={s.edited} onClick={() => setShowOld((v) => !v)}>
            edited {clock(n.edits[n.edits.length - 1].at)}
          </button>
        )}
        {!editing && (
          <button
            type="button"
            className={s.editBtn}
            onClick={() => {
              setDraft(n.text);
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className={s.editBox}>
          <textarea
            value={draft}
            autoFocus
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                editNote(n.id, draft);
                setEditing(false);
              }
              if (e.key === "Escape") setEditing(false);
            }}
          />
          <div>
            <button type="button" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className={s.saveBtn}
              onClick={() => {
                editNote(n.id, draft);
                setEditing(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <p className={s.msgText}>{n.text}</p>
      )}
      {showOld && (
        <ol className={s.history}>
          {n.edits
            .slice()
            .reverse()
            .map((e, k) => (
              <li key={k}>
                <time>{clock(e.at, true)}</time>
                <p>{e.text}</p>
              </li>
            ))}
        </ol>
      )}
    </li>
  );
}

/** The trade's notes as a small chat that members see live. */
export function Thread({ autoFocus = false }: { autoFocus?: boolean }) {
  const sym = useDesk((st) => st.settings.sym);
  const notes = useDesk((st) => st.notes);
  const trades = useDesk((st) => st.trades);
  const fills = useDesk((st) => st.fills);
  const pinned = useDesk((st) => st.thread);
  const pos = useDesk((st) => st.positions[sym]);
  const quote = useDesk(useShallow((st) => ({ last: st.quotes[sym].last })));
  const inst = INSTRUMENTS[sym];
  const [text, setText] = useState("");
  const [aim, setAim] = useState<"after" | "before" | null>(null);
  const [menu, setMenu] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  // the pop-up stays hidden for a frame while it measures itself, and a hidden
  // field can't take focus, so keep trying until the note box has it
  useEffect(() => {
    if (!autoFocus) return;
    let tries = 0;
    let raf = 0;
    const go = () => {
      const el = boxRef.current;
      if (el) {
        el.focus({ preventScroll: true });
        if (document.activeElement === el) return;
      }
      if (++tries < 30) raf = requestAnimationFrame(go);
    };
    go();
    return () => cancelAnimationFrame(raf);
  }, [autoFocus]);

  // which trade the thread is showing
  const open = pos ? trades.find((t) => t.id === pos.tradeId) : undefined;
  const lastClosed = [...trades].reverse().find((t) => t.sym === sym && t.closedAt);
  const recent = lastClosed && Date.now() - (lastClosed.closedAt ?? 0) < RECENT_MS ? lastClosed : undefined;
  const viewing: Trade | undefined = pinned ? trades.find((t) => t.id === pinned) : open ?? recent;
  const pinnedOther = !!pinned && viewing && viewing.id !== open?.id;

  const shown = useMemo(() => notes.filter((n) => (viewing ? n.tradeId === viewing.id : false)), [notes, viewing]);
  const pending = useMemo(() => notes.filter((n) => n.tradeId === null && n.sym === sym), [notes, sym]);

  // notes and every fill of the trade, in the order they happened, so members can
  // follow the adds and the exits alongside what he wrote
  type Item = { kind: "fill"; at: number; id: string; text: string; tail?: { pnl: number } } | { kind: "note"; at: number; note: Note };
  const timeline = useMemo(() => {
    const out: Item[] = shown.map((note) => ({ kind: "note" as const, at: note.at, note }));
    if (viewing) {
      const own = fills.filter((f) => f.tradeId === viewing.id);
      const dir = viewing.side === "LONG" ? 1 : -1;
      own.forEach((f, k) => {
        const last = k === own.length - 1 && !!viewing.closedAt;
        let text: string;
        if (k === 0) text = `${dir > 0 ? "Bought" : "Sold"} ${f.qty} @ ${fmt(f.price)}`;
        else if (f.side === dir) text = `Added ${f.qty} @ ${fmt(f.price)}`;
        else if (last) text = `${f.role === "stop" ? "Stopped" : f.role === "target" ? "Target" : "Closed"} @ ${fmt(f.price)}`;
        else text = `Took ${f.qty} off @ ${fmt(f.price)}`;
        out.push({ kind: "fill", at: f.at, id: f.id, text, tail: last ? { pnl: viewing.pnl } : undefined });
      });
    }
    return out.sort((a, b) => a.at - b.at);
  }, [shown, viewing, fills]);

  // what a new note attaches to
  let phase: Phase = "before";
  let target: string | null = null;
  if (viewing && !viewing.closedAt) {
    phase = "during";
    target = viewing.id;
  } else if (viewing && viewing.closedAt && (pinnedOther || (aim ?? "after") === "after")) {
    phase = "after";
    target = viewing.id;
  }
  const canChoose = !pinnedOther && !!viewing?.closedAt;

  // a chat: hold the newest note in view unless the reader has scrolled back
  const stuck = useRef(true);
  const firstScroll = useRef(true);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: firstScroll.current ? "auto" : "smooth" });
    firstScroll.current = false;
    stuck.current = true;
  }, [shown.length, pending.length, viewing?.id]);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (stuck.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => setAim(null), [viewing?.id]);

  const post = () => {
    postNote(text, viewing?.sym ?? sym, target, phase);
    setText("");
  };

  const past = [...trades].reverse().slice(0, 12);
  const pnl = viewing ? (viewing.closedAt ? viewing.pnl : viewing.pnl + (pos ? (quote.last - pos.avg) * pos.qty * inst.pv : 0)) : 0;

  return (
    <div className={s.thread}>
      <div className={s.threadBar}>
        <button type="button" className={s.threadPick} aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          {viewing ? (
            <>
              <i className={viewing.closedAt ? s.dotDone : s.dotLive} />
              <span>{tradeLabel(viewing)}</span>
              <em className={pnl >= 0 ? s.pos : s.neg}>{money(pnl)}</em>
            </>
          ) : (
            <>
              <i className={s.dotNext} />
              <span>Next {inst.code} trade</span>
            </>
          )}
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
        {pinned && (
          <button type="button" className={s.follow} onClick={() => setThread(null)}>
            Back to live
          </button>
        )}
        {menu && (
          <div className={s.menu} role="menu" onMouseLeave={() => setMenu(false)}>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setThread(null);
                setMenu(false);
              }}
            >
              <i className={s.dotLive} />
              Live: follow {inst.code}
            </button>
            {past.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                aria-current={viewing?.id === t.id}
                onClick={() => {
                  setThread(t.id);
                  setMenu(false);
                }}
              >
                <i className={t.closedAt ? s.dotDone : s.dotLive} />
                <span>{tradeLabel(t)}</span>
                <time>{clock(t.openedAt)}</time>
                <em className={t.pnl >= 0 ? s.pos : s.neg}>{t.closedAt ? money(t.pnl) : "open"}</em>
              </button>
            ))}
          </div>
        )}
      </div>

      <ol
        ref={listRef}
        className={s.msgs}
        onScroll={(e) => {
          const el = e.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {timeline.map((it, i) =>
          it.kind === "note" ? (
            <Message key={it.note.id} n={it.note} i={i} />
          ) : (
            <li key={it.id} className={s.tradeMark}>
              <span>
                {it.text}
                {it.tail && (
                  <>
                    {" · "}
                    <b className={it.tail.pnl >= 0 ? s.pos : s.neg}>{money(it.tail.pnl)}</b>
                  </>
                )}
              </span>
              <time>{clock(it.at)}</time>
            </li>
          ),
        )}
        {!pinnedOther && pending.length > 0 && (
          <>
            <li className={s.groupMark}>For the next {inst.code} trade</li>
            {pending.map((n, i) => (
              <Message key={n.id} n={n} i={i} />
            ))}
          </>
        )}
        {!shown.length && !pending.length && (
          <li className={s.empty}>
            <p>Nothing yet.</p>
            <span>Write the plan before you take it. Members see every note, with the time you sent it.</span>
          </li>
        )}
      </ol>

      <div className={s.composer}>
        <div className={s.composeTop}>
          {canChoose ? (
            <div className={s.aim} role="group" aria-label="Note for">
              <button type="button" aria-pressed={phase === "after"} onClick={() => setAim("after")}>
                After exit
              </button>
              <button type="button" aria-pressed={phase === "before"} onClick={() => setAim("before")}>
                Next trade
              </button>
            </div>
          ) : (
            <span className={`${s.phase} ${s[`phase_${phase}`]}`}>{PHASE[phase]}</span>
          )}
        </div>
        <div className={s.composeBox}>
          <textarea
            ref={boxRef}
            value={text}
            rows={1}
            placeholder={phase === "before" ? "The plan, before you take it…" : phase === "during" ? "What's changed…" : "How it went…"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                post();
              }
              if (e.key === "Escape") e.currentTarget.blur();
            }}
          />
          <button type="button" className={s.send} disabled={!text.trim()} onClick={post} aria-label="Post note">
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
