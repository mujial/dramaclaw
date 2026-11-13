# lyric-video

Illustrated lyric reel banane ka chhota tool (DramaClaw se alag, standalone).
Images + lyrics (+ optional gaana) -> 9:16 MP4 with slow zoom/pan, crossfade,
dust particles, rain, aur word-by-word lyrics (Roman + Devanagari).

## Setup

    cd lyric-video
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt

## Render

    .venv/bin/python make_video.py song1/project.json
    .venv/bin/python make_video.py song1/project.json --frame 5.0 preview.png   # ek frame check

## Project folder

- `project.json` - scenes ki list (`image`, `motion`, optional `rain`, `text_pos`,
  `text_color`: `auto` / `dark` / `light`), `lyrics`, `output`, optional `audio`.
- `lyrics.txt` - ek line = ek scene. `*shabd*` highlight word. Devanagari seedha likh sakte ho.
- Gaane ke saath sync: `"audio": "song.mp3"` jodo aur har lyric line ke aage
  `[mm:ss.xx]` timestamp likho. Timestamp na ho to har line `line_seconds` tak chalti hai.

Motions: `zoom_in`, `zoom_out`, `pan_left`, `pan_right`, `pan_up`, `pan_down`.

Fonts (`fonts/`) Google Fonts se hain, SIL Open Font License (OFL-*.txt).
