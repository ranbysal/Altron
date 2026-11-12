"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { browserClient } from "@/lib/supabase/client";
import { supabaseReady, type Role } from "@/lib/supabase/env";
import { Cell } from "@/components/trader/parts";
import s from "@/components/trader/trader.module.css";
import a from "./admin.module.css";

type Person = { id: string; email: string; role: Role; display_name: string | null; provider: string; created_at: string; last_sign_in_at: string | null; revoked_at: string | null };
type Invite = { email: string; role: Role; note: string | null; created_at: string };

const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "member", label: "Member", blurb: "Community" },
  { id: "trader", label: "Trader", blurb: "Yazan's dashboard and desk" },
  { id: "owner", label: "Owner", blurb: "Everything, including this page" },
];

/** "google,email" → "Google and password" */
const signsIn = (list: string) => {
  const ways = [...new Set(list.split(",").map((x) => (x.trim() === "google" ? "Google" : "password")))].sort();
  const text = ways.join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const when = (iso: string | null) => (iso ? DAY.format(new Date(iso)) : "Never");

function said(msg: string): string {
  if (/not_yourself/.test(msg)) return "You can't change your own role or access.";
  if (/bad_email/.test(msg)) return "That doesn't look like an email address.";
  if (/owner only/.test(msg)) return "Only the owner can do that.";
  if (/function .* does not exist|could not find the function/i.test(msg)) return "The database needs the latest schema. Run schema.sql again in Supabase's SQL editor.";
  return "That didn't work. Try again in a moment.";
}

export function Admin() {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [role, setRole] = useState<Role>("member");
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supabaseReady()) {
      setError("Sign-in isn't connected on this site yet.");
      setPeople([]);
      return;
    }
    const sb = browserClient();
    const [{ data: who }, p, i] = await Promise.all([sb.auth.getUser(), sb.rpc("admin_people"), sb.from("invites").select("email, role, note, created_at").order("created_at", { ascending: false })]);
    setMe(who.user?.id ?? null);
    if (p.error) {
      setError(said(p.error.message));
      setPeople([]);
      return;
    }
    setError(null);
    setPeople((p.data ?? []) as Person[]);
    setInvites(((i.data ?? []) as Invite[]).filter((x) => !(p.data as Person[]).some((y) => y.email.toLowerCase() === x.email)));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true);
    setFlash(null);
    const { error: e } = await fn();
    setBusy(false);
    if (e) setError(said(e.message));
    else {
      setError(null);
      setFlash(ok);
      await load();
    }
  };
  const sb = () => browserClient();

  const active = (people ?? []).filter((p) => !p.revoked_at);
  const count = (r: Role) => active.filter((p) => p.role === r).length;

  return (
    <div className={s.sheet}>
      <i className={s.sheetR} aria-hidden="true" />
      <i className={s.sheetB} aria-hidden="true" />

      <div className={a.top}>
        <Cell i={0} noTop label="Invite someone" aside="They sign in with Google or set a password" className={a.inviteCell}>
          <form
            className={a.invite}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const email = String(f.get("email") ?? "").trim();
              const note = String(f.get("note") ?? "").trim();
              const form = e.currentTarget;
              void act(() => sb().rpc("admin_invite", { p_email: email, p_role: role, p_note: note || null }), `${email} is invited as ${role}.`).then(() => form.reset());
            }}
          >
            <label className={a.field}>
              <span>Email</span>
              <input name="email" type="email" required placeholder="name@example.com" autoComplete="off" spellCheck={false} />
            </label>
            <div className={a.roles} role="radiogroup" aria-label="Role">
              {ROLES.map((r) => (
                <button key={r.id} type="button" role="radio" aria-checked={role === r.id} className={a.role} onClick={() => setRole(r.id)}>
                  <b>{r.label}</b>
                  <em>{r.blurb}</em>
                </button>
              ))}
            </div>
            <label className={a.field}>
              <span>Note, for you</span>
              <input name="note" type="text" placeholder="Optional" autoComplete="off" />
            </label>
            <button type="submit" className={a.send} disabled={busy}>
              {busy ? "One moment" : "Invite"}
            </button>
          </form>
          {(error || flash) && (
            <p role="status" className={error ? a.err : a.ok}>
              {error ?? flash}
            </p>
          )}
        </Cell>
        <Cell i={1} noTop label="Who has access" className={a.countsCell}>
          <dl className={a.counts}>
            <div>
              <dt>Members</dt>
              <dd>{people ? count("member") : "–"}</dd>
            </div>
            <div>
              <dt>Trader</dt>
              <dd>{people ? count("trader") : "–"}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd>{people ? count("owner") : "–"}</dd>
            </div>
            <div>
              <dt>Invited, not joined</dt>
              <dd>{people ? invites.length : "–"}</dd>
            </div>
          </dl>
          <p className={a.howto}>
            An invite lets one email make an account, with Google or a password, and decides what it can open. Members see Community. The trader also gets Yazan&apos;s dashboard and desk. Removing access keeps the account and everything it wrote, so it can be given back.
          </p>
        </Cell>
      </div>

      <div className={s.row1}>
        <Cell i={2} label="People" aside={people ? `${people.length} ${people.length === 1 ? "account" : "accounts"}` : "Loading"}>
          <div className={s.tableWrap}>
            <table className={`${s.log} ${a.table}`}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Signs in with</th>
                  <th>Joined</th>
                  <th>Last signed in</th>
                  <th>Access</th>
                </tr>
              </thead>
              <tbody>
                {(people ?? []).map((p, i) => {
                  const self = p.id === me;
                  return (
                    <tr key={p.id} style={{ "--k": i } as CSSProperties} data-off={p.revoked_at ? "" : undefined}>
                      <td>
                        <span className={a.who}>
                          <b>
                            {p.display_name ?? p.email.split("@")[0]}
                            {self && <span className={a.you}>You</span>}
                          </b>
                          <em>{p.email}</em>
                        </span>
                      </td>
                      <td>
                        <select className={a.select} value={p.role} disabled={self || busy} onChange={(e) => void act(() => sb().rpc("admin_set_role", { p_id: p.id, p_role: e.target.value }), `${p.email} is now ${e.target.value}.`)} aria-label={`Role for ${p.email}`}>
                          {ROLES.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className={s.dimCell}>{signsIn(p.provider)}</td>
                      <td className={s.dimCell}>{when(p.created_at)}</td>
                      <td className={s.dimCell}>{when(p.last_sign_in_at)}</td>
                      <td>
                        <button
                          type="button"
                          className={a.toggle}
                          role="switch"
                          aria-checked={!p.revoked_at}
                          disabled={self || busy}
                          onClick={() => void act(() => sb().rpc("admin_set_access", { p_id: p.id, p_on: !!p.revoked_at }), p.revoked_at ? `${p.email} has access again.` : `${p.email} no longer has access.`)}
                          aria-label={`${p.revoked_at ? "Give back" : "Remove"} access for ${p.email}`}
                        >
                          <i />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {people && !people.length && (
                  <tr>
                    <td colSpan={6} className={s.empty}>
                      No accounts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Cell>
      </div>

      <div className={s.row1}>
        <Cell i={3} label="Invited, not joined yet" aside={`${invites.length} waiting`}>
          {invites.length ? (
            <div className={s.tableWrap}>
              <table className={`${s.log} ${a.table}`}>
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Role</th>
                    <th>Note</th>
                    <th>Invited</th>
                    <th aria-label="Withdraw" />
                  </tr>
                </thead>
                <tbody>
                  {invites.map((x, i) => (
                    <tr key={x.email} style={{ "--k": i } as CSSProperties}>
                      <td>{x.email}</td>
                      <td className={a.cap}>{x.role}</td>
                      <td className={s.dimCell}>{x.note ?? "–"}</td>
                      <td className={s.dimCell}>{when(x.created_at)}</td>
                      <td className={a.right}>
                        <button type="button" className={a.withdraw} disabled={busy} onClick={() => void act(() => sb().rpc("admin_uninvite", { p_email: x.email }), `The invite for ${x.email} is withdrawn.`)}>
                          Withdraw
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={a.howto}>Nobody is waiting. Invites appear here until the person makes their account.</p>
          )}
        </Cell>
      </div>
    </div>
  );
}
