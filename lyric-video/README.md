# lyric-video

Illustrated lyric reel banane ka chhota tool (DramaClaw se alag, standalone).
Images + lyrics (+ optional gaana) -> 9:16 MP4.

Kya karta hai:

- **Pose change**: ek scene ki do drawings (`01.png` -> `01b.png`) ke beech optical-flow morph, jisse sir/haath/expression hilte dikhte hain.
- **Blink**: aankh-band wali drawing (`03k.png`) se palak jhapakna.
- **Sway / breathing**: baal, dupatta, ped, kandhe par halka wind/saans ka warp.
- **Camera**: har scene ka apna push-in / pull-out / pan, halka rotation aur handheld drift.
- **Transitions**: `flash`, `blur`, `whip_left|right|up|down`, `zoom`, `dissolve`.
- **Lyrics**: scene ke andar draw hote hain (camera ke saath chalte hain), har scene ka apna rang aur
  animation (`rise`, `drop`, `pop`, `slide`), highlight word bada + underline + chhota caption.
- Rain, lamp/sun glow flicker, dust particles, film grain, vignette.

## Setup

    cd lyric-video
    python3 -m venv .venv
    .venv/bin/pip install -r requirements.txt

## Render

    .venv/bin/python make_video.py song1/project.json
    .venv/bin/python make_video.py song1/project.json --frame 5.0 preview.png   # ek frame check

## Lyrics file

Ek line = ek scene. `*शब्द|shabd*` = highlight word + caption (`|caption` optional).
Gaane ke saath sync: project.json mein `"audio": "song.mp3"` jodo aur har line ke aage
`[mm:ss.xx]` timestamp likho. Timestamp na ho to har line `line_seconds` tak chalti hai.

## project.json - scene fields

Sab coordinates image ke hisse mein hain (0..1; x baayein se, y upar se).

| Field | Matlab |
|---|---|
| `image` | scene ki drawing |
| `pose` | `{"image", "at", "dur", "mode": "flow"/"dissolve", "max_flow"}` - doosri drawing aur kab badle (second, scene start se) |
| `blink` | `{"image", "box": [x0,y0,x1,y1], "at": [seconds]}` - chehre ka box |
| `sway` | list of `{"c": [x,y], "r": [rx,ry], "amp": px, "hz", "axis": "x"/"y"}` |
| `glow` | list of `{"c", "r", "color", "amp", "hz"}` |
| `cam` | `{"from": [cx,cy,zoom,rot], "to": [...]}` |
| `transition`, `transition_seconds` | ye scene kaise aaye |
| `rain` | `true` |
| `text`, `accent`, `text_color` (`dark`/`light`), `text_anim`, `text_pos`, `text_width`, `accent_tilt` | lyrics ka look |

Fonts (`fonts/`) Google Fonts se hain, SIL Open Font License (OFL-*.txt).
