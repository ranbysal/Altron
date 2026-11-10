/**
 * The Watcher only reads sources that allow automated readers. Before a feed is fetched,
 * its site's robots.txt is checked (once a day per site) and a disallowed path is left alone.
 */

export const UA = "Mozilla/5.0 (compatible; AltronWatcher/1.0; +https://altron.capital)";
const TOKEN = "altronwatcher";

type Rule = { allow: boolean; re: RegExp; len: number };
const cache = new Map<string, { at: number; rules: Rule[] | "none" | "closed" }>();

function compile(path: string): RegExp {
  const end = path.endsWith("$");
  const body = (end ? path.slice(0, -1) : path).split("*").map((x) => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${end ? "$" : ""}`);
}

function parse(txt: string): Rule[] {
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let cur: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const val = m[2].trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], rules: [] }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && cur) {
      lastWasAgent = false;
      if (val) cur.rules.push({ allow: key === "allow", re: compile(val), len: val.length });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && TOKEN.includes(a)));
  return (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
}

export async function allowed(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  let hit = cache.get(u.origin);
  if (!hit || Date.now() - hit.at > 86_400_000) {
    let rules: Rule[] | "none" | "closed";
    try {
      const res = await fetch(`${u.origin}/robots.txt`, { headers: { "user-agent": UA }, next: { revalidate: 86_400 }, signal: AbortSignal.timeout(6000) });
      // no robots file means no restrictions; a server error means stay away for now
      rules = res.ok ? parse(await res.text()) : res.status >= 500 ? "closed" : "none";
    } catch {
      rules = "closed";
    }
    cache.set(u.origin, (hit = { at: Date.now(), rules }));
  }
  if (hit.rules === "none") return true;
  if (hit.rules === "closed") return false;
  const path = u.pathname + u.search;
  let best: Rule | null = null;
  for (const r of hit.rules) if (r.re.test(path) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
  return best ? best.allow : true;
}
