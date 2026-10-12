export async function requestDrip(url: string, pubkey: string): Promise<{ ok: boolean; sig?: string; error?: string; skipped?: boolean }> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey }) });
  const j = await res.json().catch(() => ({}));
  return res.ok ? { ok: true, ...j } : { ok: false, error: j.error ?? `faucet ${res.status}` };
}
