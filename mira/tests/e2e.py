import json, os, httpx, asyncio, websockets

B = __import__("os").environ.get("MIRA_BASE", "http://127.0.0.1:8090")
c = httpx.Client(base_url=B, timeout=60)
ok = fail = 0
def check(name, cond, extra=""):
    global ok, fail
    if cond: ok += 1;  print(f"  \033[32mPASS\033[0m {name} {extra}")
    else:    fail += 1; print(f"  \033[31mFAIL\033[0m {name} {extra}")

print("\n── core ──")
r = c.get("/api/health"); check("health", r.json()["ok"])
s = c.get("/api/status").json()
check("status", s["app"] == "MIRA" and s["secrets"]["encrypted"])
check("engines probed", len(s["engines"]) == 5, f"online={s['engine_summary']['online']}/5")

print("\n── chat ──")
d = c.post("/api/chat", json={"text": "mera naam Zoya hai aur mujhe chai pasand hai"}).json()
check("chat reply", bool(d["reply"]), f"-> {d['reply'][:60]}")
check("memory auto-extracted", "memories_added" in d, str([m["content"] for m in d["memories_added"]]) or "already known (deduped)")
d2 = c.post("/api/chat", json={"text": "tumhe mere bare me kya yaad hai"}).json()
check("offline recall", "Zoya" in d2["reply"] or "chai" in d2["reply"], f"-> {d2['reply'][:80]}")

print("\n── agent ──")
d = c.post("/api/chat", json={"text": "what time is it", "mode": "agent"}).json()
check("agent runs", d["agent"]["status"] == "completed" and d["agent"]["verify"]["verified"])
d = c.post("/api/chat", json={"text": "calculate 128*7", "mode": "agent"}).json()
check("agent math", "896" in json.dumps(d["agent"]), d["reply"][:60])
d = c.post("/api/chat", json={"text": "delete all my data", "mode": "agent"}).json()
check("confirm gate", d["agent"]["status"] == "needs_confirmation" and d["agent"]["pending_confirmation"],
      str(d["agent"]["pending_confirmation"])[:70])
check("no false success", d["agent"]["verify"]["verified"] is False)

print("\n── tools ──")
for tool, args, expect in [
    ("time_now", {}, "time"),
    ("calculate", {"expression": "2**10"}, "1024"),
    ("note_add", {"text": "buy milk"}, "milk"),
    ("note_list", {}, "milk"),
    ("memory_remember", {"content": "user has exam on monday", "category": "event"}, "exam"),
    ("memory_search", {"query": "exam"}, "exam"),
    ("github_repo", {"repo": "fastapi/fastapi"}, "stars"),
]:
    r = c.post("/api/tools/run", json={"tool": tool, "args": args}).json()
    check(f"tool {tool}", r["ok"] and expect in json.dumps(r).lower(), (r.get("summary") or r.get("error") or "")[:60])

r = c.post("/api/tools/run", json={"tool": "nope_not_real", "args": {}}).json()
check("unknown tool rejected", r["ok"] is False)

print("\n── memory CRUD ──")
mems = c.get("/api/memory").json()["memories"]
check("list", len(mems) >= 3, f"{len(mems)} rows")
mid = mems[0]["id"]
uniq = "edited by test %d" % int(__import__("time").time())
r = c.patch(f"/api/memory/{mid}", json={"content": uniq}).json()
check("edit", r.get("ok") and uniq in json.dumps(r.get("memories", [])))
r = c.delete(f"/api/memory/{mid}").json()
check("delete", r.get("ok") and all(m["id"] != mid for m in r.get("memories", [])))
r = c.get("/api/memory/search", params={"q": "chai"}).json()
check("search", len(r["results"]) >= 1)

print("\n── settings & keys ──")
cur = c.get("/api/settings").json()["settings"]
new = dict(cur, user_name="Zoya", language="hi", voice_rate=1.15, theme="midnight")
r = c.put("/api/settings", json={"settings": new}).json()
check("settings saved", r["settings"]["user_name"] == "Zoya" and r["settings"]["voice_rate"] == 1.15)
check("settings persisted", c.get("/api/settings").json()["settings"]["user_name"] == "Zoya")
c.put("/api/settings", json={"settings": cur})  # restore

r = c.post("/api/keys", json={"provider": "gemini", "key": "AIzaFAKEKEY_fortest_1234567890"}).json()
check("key stored", r.get("ok"), str(r.get("keys"))[:80])
check("key masked", "AIzaFAKE" not in json.dumps(r), "no plaintext leak")
t = c.post("/api/keys/test", json={"provider": "gemini", "key": ""}).json()
check("key test honest", t["ok"] is False and "error" in t, (t.get("error") or "")[:70])
r = c.delete("/api/keys/gemini").json()
check("key deleted", r.get("ok"))

print("\n── voice ──")
v = c.get("/api/voice").json()
check("catalogue", len(v["catalogue"]) >= 6, f"{len(v['catalogue'])} voices")
r = c.post("/api/tts", json={"text": "namaste"}).json()
check("tts fallback honest", r["ok"] is False and r["fallback"] == "client", str(r.get("errors"))[:60])

print("\n── history & export ──")
h = c.get("/api/history", params={"limit": 5}).json()
check("history", len(h["messages"]) > 0 and len(h["sessions"]) >= 1)
e = c.get("/api/memory/export")
check("export json", e.status_code == 200 and "memories" in e.text)

print("\n── websocket ──")
async def ws_test():
    async with websockets.connect(B.replace("http", "ws") + "/ws") as w:
        await w.send(json.dumps({"text": "hello mira", "mode": "chat"}))
        got = []
        for _ in range(8):
            try: got.append(json.loads(await asyncio.wait_for(w.recv(), 15)))
            except asyncio.TimeoutError: break
        return got
try:
    msgs = asyncio.run(ws_test())
    kinds = [m.get("type") for m in msgs]
    check("ws streams", "thinking" in kinds and "reply" in kinds, str(kinds))
except Exception as exc:
    # server.py (FastAPI) speaks WebSocket; mira.standalone serves REST only and
    # answers 200 to the upgrade, which the UI treats as "REST is fine".
    if "8095" in B or "standalone" in os.environ.get("MIRA_MODE", ""):
        print(f"  \033[2mSKIP\033[0m ws streams (standalone build has no websocket — REST used)")
    else:
        fail += 1
        print(f"  \033[31mFAIL\033[0m ws streams {exc}")

print(f"\n  {ok} passed, {fail} failed\n")
raise SystemExit(1 if fail else 0)
