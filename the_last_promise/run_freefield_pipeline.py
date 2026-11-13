#!/usr/bin/env python3
"""Orchestrates THE LAST PROMISE through Freefield's LTX-2.5 GPU pipelines.

Requires a working Freefield GPU backend (Modal L40S/H100 or local ComfyUI GPU)
configured via COMFY_BASE_URL and FREEFIELD_TOKEN in /home/user/freefield/.env.

Usage:
    python3 run_freefield_pipeline.py --dry-run   # Validate assets, manifest & commands
    python3 run_freefield_pipeline.py             # Submit shots to Freefield & composite final MP4
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
FREEFIELD_DIR = Path("/home/user/freefield")
WORKFLOW_JSON = PROJECT_DIR / "dramaclaw_workflow.json"
OUT_CLIPS = PROJECT_DIR / "freefield_clips"

SHOT_PROMPTS = {
    "1_1": "2D Japanese theatrical anime film, slow aerial crane push-in over ancient cliffside torii shrine ruins in heavy midnight storm rain, flickering warm stone lanterns, lightning flash illuminating wet stone steps, atmospheric fog, fluid rain animation",
    "1_2": "2D Japanese theatrical anime film, medium close-up of Kai (black hair, deep blue eyes, black high-collar jacket, silver diamond pendant) standing in pouring rain at night shrine, hair and jacket swaying in wind, emotional lip-synced Hindi speech, blinking eyes",
    "1_3": "2D Japanese theatrical anime film, extreme close-up dolly-in on Kai's silver geometric diamond pendant on black jacket in rain, glowing mystical cyan-violet energy pulsing from inside the crystal, rain droplets sliding",
    "2_1": "2D Japanese theatrical anime film, over-the-shoulder shot past Kai in dark jacket as Mira (long silver-white hair, violet eyes, white lace dress with blue bow and ribbon) materializes in luminous silver glow under moonlit torii gate, swirling cherry blossom petals",
    "2_2": "2D Japanese theatrical anime film, medium shot of Mira standing gracefully in moonlight, silver hair and white lace dress swaying softly, drifting pink sakura petals, gentle blinking and sincere lip-synced Hindi speech",
    "2_3": "2D Japanese theatrical anime film, intimate close-up of Mira's face and luminous violet eyes under glowing moonbeams, tender emotional expression, wind brushing silver hair strands, drifting sakura petals",
    "3_1": "2D Japanese theatrical anime film, dynamic low-angle action shot of Kai planting boots on cracked shrine stone, crimson curse lightning tearing storm clouds, silver pendant blazing bright blue, jacket flaring in wind, anime speedlines and camera shake",
    "3_2": "2D Japanese theatrical anime film, dynamic action shot of Kai holding Mira's hand on crumbling cliffside as Mira projects a rotating glowing cyan-violet arcane magic circle deflecting crimson lightning bolts, wind, flying debris",
    "3_3": "2D Japanese theatrical anime film, massive anime energy shockwave bursting outward in radiant violet-white light beneath torii arch, clearing dark storm clouds into golden dawn horizon, flying sakura petals",
    "4_1": "2D Japanese theatrical anime film, emotional sunrise wide shot in golden torii courtyard, Kai cradling Mira in his arms as translucent blue-gold stardust particles rise from her dissolving silver hair and white dress, sakura petals drifting",
    "4_2": "2D Japanese theatrical anime film, intimate close-up of Kai looking down tearfully at Mira with fierce tenderness, glowing golden dawn backlight, silver diamond pendant gleaming, gentle lip-synced Hindi vow",
    "4_3": "2D Japanese theatrical anime film, poetic close-up as Mira's silhouette dissolves into shimmering golden stardust and cherry blossoms beside sunlit torii stone lanterns, leaving her royal-blue ribbon",
    "5_1": "2D Japanese theatrical anime film, Kai standing bathed in golden sunrise beams at peaceful shrine courtyard holding Mira's royal-blue ribbon trailing from his hand in soft morning breeze, drifting sakura petals, calm determined smile",
    "5_2": "2D Japanese theatrical anime film, serene upward tilt into pastel blue-and-peach sunrise sky with volumetric sunbeams and slow drifting cherry blossom shower",
}


def load_env(env_path: Path) -> dict[str, str]:
    vals: dict[str, str] = {}
    if not env_path.exists():
        return vals
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        vals[k.strip()] = v.strip()
    return vals


def build_jobs(wf: dict) -> list[dict]:
    jobs = []
    for scene in wf["scenes"]:
        for shot in scene["shots"]:
            sid = shot["shot_id"]
            start = float(shot["start"])
            end = float(shot["end"])
            dur = max(2, min(10, math.ceil(end - start)))
            img_path = PROJECT_DIR / shot["asset"]
            dlg = shot.get("dialogue")
            # Use LTX-2.5 audio-to-video ('talking') only on solo speaking close-ups
            use_talking = bool(dlg) and sid in {"1_2", "2_2", "4_2", "5_1"}
            if use_talking:
                audio_path = PROJECT_DIR / dlg["audio"]
                cmd = [
                    "npm", "run", "app", "--", "talking",
                    "--file", f"portrait={img_path}",
                    "--file", f"audio={audio_path}",
                    "--set", f"prompt={SHOT_PROMPTS[sid]}",
                    "--set", "negative=blurry, distorted face, warped mouth, extra limbs, character redesign",
                    "--set", "start=0",
                    "--set", f"duration={dur}",
                    "--set", "enhance=false",
                    "--set", f"seed={1000 + len(jobs)}",
                    "--out", str(OUT_CLIPS / sid),
                ]
            else:
                cmd = [
                    "npm", "run", "app", "--", "video",
                    "--file", f"image={img_path}",
                    "--set", f"prompt={SHOT_PROMPTS[sid]}",
                    "--set", f"duration={dur}",
                    "--set", "enhance=false",
                    "--set", "aspect=16:9 (Widescreen)",
                    "--set", f"seed={1000 + len(jobs)}",
                    "--out", str(OUT_CLIPS / sid),
                ]
            jobs.append({
                "shot_id": sid,
                "app": "talking" if use_talking else "video",
                "start": start,
                "end": end,
                "target_duration": round(end - start, 3),
                "request_seconds": dur,
                "image": img_path,
                "audio": (PROJECT_DIR / dlg["audio"]) if use_talking else None,
                "cmd": cmd,
            })
    return jobs


def check_backend_ready() -> tuple[bool, str]:
    env = load_env(FREEFIELD_DIR / ".env")
    url = os.environ.get("COMFY_BASE_URL") or env.get("COMFY_BASE_URL", "")
    token = os.environ.get("FREEFIELD_TOKEN") or env.get("FREEFIELD_TOKEN", "")
    if not url or "YOUR-WORKSPACE" in url:
        return False, "COMFY_BASE_URL in /home/user/freefield/.env is still unconfigured (placeholder URL)."
    if not token:
        return False, "FREEFIELD_TOKEN is missing in /home/user/freefield/.env."
    return True, f"Configured COMFY_BASE_URL={url}"


def find_ffmpeg() -> str:
    import shutil
    if shutil.which("ffmpeg"):
        return "ffmpeg"
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        raise RuntimeError("Neither system ffmpeg nor imageio-ffmpeg is installed.")


def assemble_final_4k(jobs: list[dict], out_mp4: Path) -> None:
    ff = find_ffmpeg()
    trimmed_dir = OUT_CLIPS / "_trimmed"
    trimmed_dir.mkdir(parents=True, exist_ok=True)
    concat_txt = trimmed_dir / "concat.txt"
    lines: list[str] = []

    for j in jobs:
        sid = j["shot_id"]
        clip_dir = OUT_CLIPS / sid
        candidates = sorted(
            [p for p in clip_dir.glob("*") if p.suffix.lower() in {".mp4", ".webm", ".mov"}],
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            raise FileNotFoundError(f"No video output found in {clip_dir}")
        src = candidates[0]
        dst = trimmed_dir / f"{sid}.mp4"
        subprocess.run([
            ff, "-y", "-i", str(src),
            "-t", f"{j['target_duration']:.3f}",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,setsar=1",
            "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p",
            str(dst),
        ], check=True)
        lines.append(f"file '{dst.resolve()}'\n")

    concat_txt.write_text("".join(lines), encoding="utf-8")
    merged = trimmed_dir / "merged_1080p.mp4"
    subprocess.run([
        ff, "-y", "-f", "concat", "-safe", "0", "-i", str(concat_txt),
        "-c", "copy", str(merged),
    ], check=True)

    font = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"
    vf = (
        "scale=3840:2160:flags=lanczos,"
        f"drawtext=fontfile='{font}':text='THE LAST PROMISE':fontcolor=0xFFF8E8:fontsize=184:"
        "shadowcolor=0x0E1224@0.88:shadowx=4:shadowy=6:"
        "x=(w-text_w)/2:y=(h*0.43-text_h/2):"
        "alpha='if(lt(t,55.0),0,if(lt(t,55.9),(t-55.0)/0.9,if(lt(t,58.0),1,if(lt(t,58.9),(58.9-t)/0.9,0))))',"
        "fade=t=in:st=0:d=0.6,fade=t=out:st=58.7:d=1.3"
    )
    subprocess.run([
        ff, "-y",
        "-i", str(merged),
        "-i", str(PROJECT_DIR / "audio" / "master_mix.mp3"),
        "-i", str(PROJECT_DIR / "subtitles" / "subtitles_hi.srt"),
        "-i", str(PROJECT_DIR / "subtitles" / "subtitles_en.srt"),
        "-map", "0:v:0", "-map", "1:a:0", "-map", "2:s:0", "-map", "3:s:0",
        "-vf", vf,
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-c:s", "mov_text",
        "-metadata:s:s:0", "language=hin", "-metadata:s:s:0", "title=Hindi",
        "-metadata:s:s:1", "language=eng", "-metadata:s:s:1", "title=English",
        "-movflags", "+faststart",
        str(out_mp4),
    ], check=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Validate inputs and print planned Freefield CLI calls without executing GPU jobs")
    args = ap.parse_args()

    if not FREEFIELD_DIR.exists():
        print(f"ERROR: Freefield not found at {FREEFIELD_DIR}", file=sys.stderr)
        return 1
    wf = json.loads(WORKFLOW_JSON.read_text(encoding="utf-8"))
    jobs = build_jobs(wf)

    # Verify all referenced files & apps exist
    for j in jobs:
        assert j["image"].exists(), f"Missing shot image: {j['image']}"
        if j["audio"] is not None:
            assert j["audio"].exists(), f"Missing dialogue audio: {j['audio']}"
        assert (FREEFIELD_DIR / "apps" / j["app"] / "app.json").exists(), f"Missing Freefield app: {j['app']}"

    ready, status_msg = check_backend_ready()
    print(f"Validated {len(jobs)} shots against {FREEFIELD_DIR / 'apps'} ({status_msg})")
    if args.dry_run:
        for j in jobs:
            print(f"[{j['shot_id']}] ({j['start']:.2f}s-{j['end']:.2f}s, {j['app']}) -> {' '.join(j['cmd'])}")
        return 0

    if not ready:
        print(f"CANNOT RUN LIVE I2V: {status_msg}", file=sys.stderr)
        print("Set COMFY_BASE_URL to your Modal deployment (`modal deploy infra/modal_app.py`) or local GPU gateway (`python tools/local_backend.py serve`) first.", file=sys.stderr)
        return 2

    OUT_CLIPS.mkdir(parents=True, exist_ok=True)
    for j in jobs:
        print(f"Running Freefield {j['app']} for shot {j['shot_id']}...")
        subprocess.run(j["cmd"], cwd=FREEFIELD_DIR, check=True)

    out_mp4 = PROJECT_DIR / "the_last_promise_freefield_4k.mp4"
    assemble_final_4k(jobs, out_mp4)
    print("Generated Freefield AI-video master:", out_mp4)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
