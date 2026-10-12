/** N concurrent guests × M practice battles. Prints failures + latency percentiles. N=20 M=3 pnpm --filter scripts loadtest */
import { makeClient, newPlayer, playPracticeToEnd, stats } from "./lib/play";

const N = Number(process.env.N ?? 10), M = Number(process.env.M ?? 2);
async function one(i: number) {
  const client = makeClient();
  const errs: string[] = [], lock: number[] = [], res: number[] = [], start: number[] = [];
  try {
    const p = await newPlayer(client, "g" + i);
    for (let m = 0; m < M; m++) {
      const r = await playPracticeToEnd(client, p.signer, i % 8, (i + 3) % 8, i % 3);
      start.push(r.start.ms); r.turns.forEach((t) => { lock.push(t.lockMs); res.push(t.resolveMs); });
      if (r.arena.phase !== 5) errs.push("battle did not finish");
    }
  } catch (e: any) { errs.push(String(e.message).slice(0, 120)); }
  return { errs, lock, res, start };
}
(async () => {
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => one(i)));
  const errs = rs.flatMap((r) => r.errs);
  console.log(JSON.stringify({ guests: N, battlesEach: M, errors: errs.length, errs: errs.slice(0, 5), start: stats(rs.flatMap((r) => r.start)), lock: stats(rs.flatMap((r) => r.lock)), resolve: stats(rs.flatMap((r) => r.res)) }, null, 1));
  process.exit(errs.length ? 1 : 0);
})();
