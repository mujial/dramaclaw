# MORA (REDMAGIC) — poora teardown, aur MIRA ko waisa banane ka plan

Research date: 2025-11-16. Sources listed at the end.

---

## 1. Mora kya hai (asal kahani)

- **Kiski hai:** Nubia / REDMAGIC ki official AI mascot. Pehli baar **REDMAGIC 8 Pro** (2023) me
  aayi, phir 8S Pro, 9 Pro, 10 Pro, 11 Pro — sab me.
- **Character:** pink-baalo wali anime ladki, jo **saal 2122 se waqt me peeche aayi hai** "aapki
  madad karne". REDMAGIC khud use *"AI WAIFU"* kehti hai.
- **Do version:** China ROM me **poora** feature set, global ROM me **limited** (kuch skins +
  battery animation). Yahi wajah hai ki log unofficial APK dhoondhte hain.
- **11 Pro me upgrade:** interactive intro, "AI-powered personalized daily chat", aur
  **customizable 3D skins/outfits**.

**Sabse important technical baat:** Mora asal 3D model nahi hai — wo **Live2D Cubism** se bani hai
(Live2D ke official showcase me "Redmagic Mora" listed hai). Matlab: 2D layers (baal, aankh,
kapde) jo physics se hilte hain, VTuber models ki tarah. Isliye wo **kabhi crop nahi hoti, kabhi
galat frame nahi hoti, aur hamesha smooth lagti hai** — kyunki camera hi nahi hai, bas ek
character + parallax.

> **MIRA ke liye sabak:** hamare paas aapka asli **GLB 3D model** hai. Wahi zyada powerful hai
> (lighting, real shadows, kisi bhi angle se), par usme camera framing ka jhanjhat hai. Isi liye
> framing ko *hamesha* body-centre + margin par lock karna hai (v3.0 me kiya).

---

## 2. Feature inventory — Mora kya-kya karti hai

| # | Module | Kya hota hai | MIRA me status |
|---|--------|--------------|----------------|
| 1 | **Interactive Desktop** | Home screen par chhoti Mora khadi rehti hai, size/position change ho sakti hai, **tap karne par react** karti hai (awaaz + animation) | ⚠️ Aapki app ke andar hai, home screen par nahi. Tap reaction **aaj add kiya** |
| 2 | **Mora Care** | Notifications: battery low, signal weak, mausam, "kaise ho?" — ek **virtual pet** bhi | ❌ Nahi hai |
| 3 | **Mora Awakening** | Alarm: subah uthaati hai, **snooze dabao to daantti hai** | ❌ Nahi hai |
| 4 | **Energy Replenishment** | Charger lagate hi "charging room" scene, AOD par soti hui | ❌ Nahi hai |
| 5 | **Dress up / skins** | 5 skins: Time Travel, Cyber Academy, Summer Dream, Summer Swimsuit, Red Devil + kapde/baal/accessories | ❌ Nahi hai (ek hi GLB) |
| 6 | **Mora Live** | Streaming avatar (mobile + PC), size/transparency/camera overlay | ❌ Nahi (bhaari) |
| 7 | **AR camera / Photograph with Mora** | Camera me Mora ko AR object ki tarah daal ke photo | ❌ Nahi (ARCore chahiye) |
| 8 | **Mora Mail / News / Achievements** | Account-locked extra content | ❌ (skip — bekar) |
| 9 | **Chat assistant** (8 Pro+) | Mora se baat — backstory, daily chat | ✅ Gemini se, **behtar** |
| 10 | **Game Space narrator + AI Coach + Voice Control + Win Rate** (11 Pro) | Game ke andar tips, narration, hand-free commands | ❌ (game detection chahiye) |
| 11 | **In-game chat relay** (11 Pro) | Game chat me Mora ki awaaz me jawab | ❌ |

---

## 3. Jo Mora me **kharab** hai — aur hume wo galti nahi karni

Reviewers ne (Android Police, AT&T/Yahoo 11 Pro review) ye nuks nikaale:

1. **Do alag voice actors**, dono bilkul alag lagte hain — "97% lines ek boring awaaz me".
2. **Awaaz animation se peeche** chalti hai.
3. Awaaz **symbols bol deti hai** — `~` ko "tilde" padh deti hai: *"Mora loves you tilde"*.
4. Lines **pre-recorded** hain — kabhi badalti nahi. "Decoration, assistant nahi".

**MIRA in chaaron me ulta hai:** ek hi Gemini female voice, real TTS (text se banti hai, isliye
kabhi out-of-sync nahi), aur aaj se **har reply `tidy()` se guzarti hai** — `*...*`, `[...]`,
emoji, `~`, `**` sab strip. Wo "tilde" wali sharam hamesha ke liye khatam.

---

## 4. MIRA ko Mora jaisa banane ka plan (priority order)

### P0 — feel (isse hi "Mora jaisa" lagta hai)
1. **🔥 Ho gaya (v3.1):** tap/poke reaction — 1 tap par pyaar se, 5 baar poke karne par daantti
   hai, battery 15% se neeche ho to charger yaad dilati hai.
2. **🔥 Ho gaya (v3.0):** poori body framing — posed vertices se measure, camera body-centre par.
3. **Idle variety:** har 20–40s par chhoti harkat (sar ghumana, pallu, saans) — Mora ka asli
   charm yahi hai, wo kabhi "still image" nahi lagti.
4. **Bolte waqt lip-sync** — TTS ke saath mouth bone ya jaw bone ko drive karna.

### P1 — "Care" (jo Mora ko companion banata hai)
5. **Battery events:** 15% par "charger laga do", full charge par "bhar gayi".
6. **Charging scene:** charger lagne par alag pose/line (Energy Replenishment ka halka version).
7. **Mora Awakening:** alarm + subah ki line + snooze par daantna.
8. **Weather greeting:** subah pehli baar kholne par "aaj Nepalgunj me 28°, baarish lagti hai".
9. **"Kaise ho?" check-in:** din me 1–2 baar, sirf agar user ne app khola ho (spam nahi).

### P2 — personalization
10. **Skins:** ek se zyada GLB (aap aur bhejo), Settings me swap + size/position slider.
11. **Home screen widget** (asli Mora jaisa): overlay bubble jo home par chhoti model dikhaye —
    bina app khole. (Humara overlay service isi ke liye ready hai.)

### P3 — bhaari / baad me
12. Mora Live (streaming), AR camera, Game Space narration (UsageStats se game detect),
    in-game chat relay.

---

## 5. Honest baatein (jhooth nahi)

- Mora ka **character art unki property hai** — hum unka model copy nahi kar sakte. Hum aapka
  GLB use karte hain, jo aapne khud diya.
- Mora **Live2D** hai, MIRA **3D** — matlab MIRA zyada realistic ho sakti hai (shadow, lighting,
  kisi bhi angle se), par framing ka kaam hume khud karna padta hai.
- Mora ki tarah "50 pre-recorded lines" hum nahi karenge — MIRA ke paas Gemini hai, wo har baar
  naya jawab degi. Yahi Mora se aage ki cheez hai.

---

## 6. Sources

- REDMAGIC official: "Getting to Know Mora" — https://global.redmagic.gg/blogs/product-information/getting-to-know-mora-redmagic-s-ai-virtual-companion
- REDMAGIC 11 Pro features (Mora upgrades, AI coach) — https://global.redmagic.gg/blogs/product-information/meet-redmagic-11-pro
- Live2D official showcase listing "Redmagic Mora" — https://www.live2d.com/en/showcase/title/redmagic-mora/
- REDMAGIC support: Mora skins list — https://rminternal.gorgias.help/en-US/what-skins-are-available-for-redmagic-mora-2213950
- Toolify: RedMagic 8 Pro Mora guide (Mora Care, Awakening, Energy Replenishment, Live, AR) —
  https://www.toolify.ai/ai-news/redmagic-8-pro-exploring-the-mora-ai-assistant-for-global-gamers-3647446
- Android Police: "Redmagic's virtual companion Mora is not what you think" —
  https://www.androidpolice.com/redmagic-virtual-companion-mora/
- AT&T/Yahoo: REDMAGIC 11 Pro review (voice problems, "tilde") —
  https://currently.att.yahoo.com/att/redmagic-11-pro-gaming-smartphone-170000033.html
- Reddit r/RedMagic: Mora model/limits threads —
  https://www.reddit.com/r/RedMagic/comments/1v7qzqr/what_ai_model_is_mora/
