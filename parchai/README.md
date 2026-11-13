# Parchai-style kinetic lyric edit

`make_parchai.py` rebuilds a 27 s square kinetic-typography edit shot by shot:
own drawings in `img/`, camera moves, whip/blur/flash effects and animated words.

    ../lyric-video/.venv/bin/pip install -r ../lyric-video/requirements.txt
    ../lyric-video/.venv/bin/python make_parchai.py          # -> output/parchai_recreation.mp4
    ../lyric-video/.venv/bin/python make_parchai.py --sheet  # contact sheets for checking

Put the reference clip next to the script as `source.mp4` to get its audio
(it is not committed). Fonts: Poppins, Anton, Kalam (in `../lyric-video/fonts`)
and Yellowtail (`fonts/`, Apache-2.0).
