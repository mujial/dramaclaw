# kinetic – Parchai-style lyric edits

`fx.py` is the shared toolkit (camera, whip/blur/flash, slit, card, ink wipe, animated words);
each song is one script that describes its shots as functions of time.

    ../lyric-video/.venv/bin/pip install -r ../lyric-video/requirements.txt
    ../lyric-video/.venv/bin/python i_met_her_again.py          # -> output/i_met_her_again_kinetic.mp4
    ../lyric-video/.venv/bin/python i_met_her_again.py --sheet  # contact sheets for checking

Drawings: `img/` plus `../lyric-video/song1/`. Audio: `../lyric-video/song1/song_clip.m4a`.
