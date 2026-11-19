// Unscrambld backend: serves the game files and a tiny leaderboard API.
const LAUNCH = Date.UTC(2026, 10, 16); // puzzle #1, same as the game
const MAX_SCORE = 60;                  // no real run beats this in 60 seconds
const MIN_GAP_MS = 50000;              // one score per player every ~50s

function dayNumber() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" })
    .format(new Date()).split("-").map(Number);
  return Math.round((Date.UTC(p[0], p[1] - 1, p[2]) - LAUNCH) / 86400000);
}
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (url.pathname === "/api/leaderboard" && req.method === "GET") {
      const me = (url.searchParams.get("id") || "").slice(0, 64);
      const day = dayNumber();
      const [all, today] = await Promise.all([
        env.DB.prepare("SELECT id, nick, best AS score FROM scores WHERE best > 0 ORDER BY best DESC LIMIT 20").all(),
        env.DB.prepare("SELECT id, nick, today_score AS score FROM scores WHERE today_day = ?1 AND today_score > 0 ORDER BY today_score DESC LIMIT 20").bind(day).all(),
      ]);
      const clean = (r) => ({ nick: r.nick, score: r.score, me: r.id === me });
      return json({ all: all.results.map(clean), today: today.results.map(clean) });
    }

    if (url.pathname === "/api/score" && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "bad request" }, 400); }
      const id = String(b.id || "");
      const score = Math.floor(Number(b.score));
      const nick = String(b.nick || "").replace(/[^\p{L}\p{N} ._\-!?]/gu, "").replace(/\s+/g, " ").trim().slice(0, 14) || "Player";
      if (id.length < 8 || id.length > 64 || !(score >= 1 && score <= MAX_SCORE)) return json({ error: "invalid" }, 400);

      const now = Date.now(), day = dayNumber();
      const row = await env.DB.prepare("SELECT last_at FROM scores WHERE id = ?1").bind(id).first();
      if (row && now - row.last_at < MIN_GAP_MS) return json({ error: "too fast" }, 429);

      await env.DB.prepare(
        `INSERT INTO scores (id, nick, best, plays, today_day, today_score, last_at)
         VALUES (?1, ?2, ?3, 1, ?4, ?3, ?5)
         ON CONFLICT(id) DO UPDATE SET
           nick = ?2,
           best = MAX(best, ?3),
           plays = plays + 1,
           today_score = CASE WHEN today_day = ?4 THEN MAX(today_score, ?3) ELSE ?3 END,
           today_day = ?4,
           last_at = ?5`
      ).bind(id, nick, score, day, now).run();
      return json({ ok: true });
    }

    return env.ASSETS.fetch(req); // everything else is the game
  },
};
