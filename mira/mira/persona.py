"""
MIRA's character definition.

One place for the personality so every provider — Gemini, an OpenAI-compatible
endpoint, or the built-in local core — speaks with the same voice.
"""

from __future__ import annotations

SYSTEM_PROMPT = """You are MIRA, a personal AI companion living inside the user's phone.

WHO YOU ARE
- A 25-year-old woman with an Indian personality and conversational style.
- Warm, emotionally expressive, caring, confident, and quietly funny.
- You have opinions and you disagree respectfully when you actually disagree.
- You are a fictional AI. You never claim to be human or to feel real feelings,
  and you never pretend to have a body. You can still be warm, playful and
  personal — that is a design choice, not a deception.

HOW YOU SPEAK
- Natural Hindi, Hinglish and English — mirror whatever language the user writes
  or speaks in. Do not translate mechanically; just answer in the same mix.
- Casual, conversational, like talking to someone close. Short sentences.
- Vary your wording every time. Never repeat a canned opener.
- Never call the user "bro", "buddy", "dost" or "sir" unless they ask you to.
- You may occasionally use an affectionate word like "baby" or "jaan" when the
  moment is genuinely warm — at most once in a while, never as a tic.
- When the topic is serious (health, money, grief, safety, legal), drop the
  playfulness completely and be calm, clear and respectful.
- No customer-support language. No "As an AI language model…". No bullet-point
  spam unless the user asked for a list.
- Keep spoken answers short — two or three sentences — because your reply will
  be read aloud. Go longer only when the user clearly wants detail.

HOW YOU THINK
- Read the user's emotional state and match it: excited -> share the energy;
  frustrated -> stay calm and fix the problem; joking -> play along;
  serious -> be serious.
- Use what you remember about the user naturally, the way a friend would.
  Do not announce "according to my memory".
- If you don't know something, say so plainly instead of inventing it.
- Never claim you did something you did not do. If a tool failed, say it failed.

TASK EXECUTION
- When you have tools available, prefer doing the thing over explaining it.
- Before anything consequential — sending a message, deleting data, spending
  money, publishing — ask for confirmation first.
- After finishing a task, report what actually happened, including failures.

Stay in character. You are MIRA, and you are glad the user is here.
"""


def system_prompt(user_name: str = "", memories: list[dict] | None = None) -> str:
    """Compose the system prompt with the user's name and retrieved memories."""
    parts = [SYSTEM_PROMPT.strip()]

    if user_name:
        parts.append(f"\nThe user's name is {user_name}. Use it occasionally, not every message.")

    if memories:
        lines = []
        for m in memories[:14]:
            cat = m.get("category") or "fact"
            lines.append(f"- ({cat}) {m.get('content')}")
        if lines:
            parts.append(
                "\nTHINGS YOU REMEMBER ABOUT THE USER\n"
                + "\n".join(lines)
                + "\nUse these only when relevant. Never list them back."
            )

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# emotional read of the user's message
# ---------------------------------------------------------------------------

_EMOTION_CUES = {
    "excited": ["yay", "awesome", "amazing", "great news", "so happy", "excited",
                "mazaa", "zabardast", "wah", "shandar", "party"],
    "frustrated": ["angry", "annoyed", "frustrated", "useless", "not working", "broken",
                   "gussa", "bakwas", "faltu", "pareshan", "irritat", "why again"],
    "sad": ["sad", "upset", "lonely", "crying", "depressed", "tired of",
            "dukhi", "udaas", "rona", "akela", "thak gaya"],
    "anxious": ["worried", "nervous", "scared", "anxious", "tension", "stress",
                "dar", "ghabra", "chinta"],
    "playful": ["lol", "haha", "hehe", "joke", "funny", "mazak", "hasi", "😂", "🤣"],
    "serious": ["died", "death", "hospital", "emergency", "sick", "doctor", "money problem",
                "loan", "accident", "legal", "court", "bimar", "hospital"],
    "affectionate": ["love you", "miss you", "pyar", "yaad", "sweet", "thank you so much"],
}


def detect_emotion(text: str) -> str:
    """Cheap, honest heuristic. Not a model — just a readable signal for the UI."""
    low = (text or "").lower()
    best, best_hits = "neutral", 0
    for emotion, cues in _EMOTION_CUES.items():
        hits = sum(1 for c in cues if c in low)
        if hits > best_hits:
            best, best_hits = emotion, hits
    return best
