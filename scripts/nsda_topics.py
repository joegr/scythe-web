"""Refresh api/nsda_topics.json from the NSDA's topics page (https://www.speechanddebate.org/topics/).

    python3 scripts/nsda_topics.py                  (fetches the page)
    python3 scripts/nsda_topics.py --html page.html

Reads the "Past Topics - <event>" toggles (Policy, Lincoln-Douglas, Public Forum, Big Questions) into records:
{event, season, period, resolution, slug}. Slugs are ids: cards are filed under them. So a refresh only adds, and a
reworded resolution keeps its slug and takes the new wording. If a topic the file has is no longer on the page (the
page changed shape), it stops and names them, and nothing is written. Stdlib only.
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

EVENTS = {
    "Policy Debate": "policy",
    "Lincoln-Douglas Debate": "ld",
    "Public Forum Debate": "pf",
    "Big Questions": "bq",
}
SLUG_MAX = 44
EVENT_SHORT = {"policy": "cx", "ld": "ld", "pf": "pf", "bq": "bq"}
_TAG = re.compile(r"<[^>]+>")
_SEASON = re.compile(r"(\d{4})\s*[-–]\s*(\d{4})")
_DASH = re.compile(r"\s+[–—-]\s+")
_STOP = {"the", "a", "an", "of", "in", "on", "to", "and", "or", "its", "should", "ought", "be", "is", "that",
         "resolved", "united", "states", "federal", "government", "substantially", "significantly", "increase",
         "for", "with", "by", "one", "more", "following", "than", "s"}


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(_TAG.sub(" ", fragment))).strip()


def slugify(event: str, season: str, period: str, resolution: str) -> str:
    """Short, label-safe id, e.g. `ld-2024-25-novdec-wealth-tax` (<= 44 chars: short enough for labels and file names)."""
    y = _SEASON.search(season)
    season_part = f"{y.group(1)}-{y.group(2)[2:]}" if y else re.sub(r"\W+", "", season)
    per = re.sub(r"[^a-z]", "", period.lower())
    per = {"septemberoctober": "sepoct", "novemberdecember": "novdec", "januaryfebruary": "janfeb",
           "marchapril": "marapr"}.get(per, per[:8])
    if per.startswith("nationals") or "national" in per:
        per = "nats"
    words = [w for w in re.findall(r"[a-z]+", resolution.lower().replace("resolved:", "")) if w not in _STOP]
    head = "-".join(p for p in (EVENT_SHORT[event], season_part, per) if p)
    tail = ""
    for w in words:
        nxt = f"{tail}-{w}" if tail else w
        if len(head) + 1 + len(nxt) > SLUG_MAX:
            break
        tail = nxt
    return f"{head}-{tail}" if tail else head


def _sections(page: str):
    for m in re.finditer(r"Past Topics - ([^<]+)</h5>", page):
        name = html.unescape(m.group(1)).strip()
        if name not in EVENTS:
            continue
        end = page.find("et_pb_toggle_title", m.end())
        yield EVENTS[name], page[m.end(): end if end > 0 else len(page)]


def _split(item: str) -> tuple[str, str]:
    text = _text(item).lstrip("°").strip()
    i = text.find("Resolved")
    if i > 0:
        return _DASH.sub(" ", text[:i]).strip(" –—-:"), text[i:].strip()
    return "", text


def parse(page: str) -> list[dict]:
    out, seen = [], set()
    for event, body in _sections(page):
        if event == "bq":
            for season, res in re.findall(r"<strong>\s*(\d{4}\s*-\s*\d{4})\s*</strong>\s*[–—-]\s*(.*?)(?:</p>|</div>)",
                                          html.unescape(body), re.S):
                out.append(_record(event, season.replace(" ", ""), "", _text(res)))
            continue
        for season, chunk in re.findall(r"<h5>\s*([^<]+?)\s*</h5>(.*?)(?=<h5>|$)", body, re.S):
            for item in re.findall(r"<(?:li|p)>(.*?)</(?:li|p)>", chunk, re.S):
                period, resolution = _split(item)
                if resolution.lower().startswith("resolved"):
                    out.append(_record(event, season, period, resolution))
    deduped = []
    for r in out:
        if r["slug"] in seen:  # identical resolution repeated on the page
            continue
        seen.add(r["slug"])
        deduped.append(r)
    return deduped


def _record(event: str, season: str, period: str, resolution: str) -> dict:
    resolution = re.sub(r"\s+", " ", resolution).strip()
    return {"event": event, "season": season.strip(), "period": period, "resolution": resolution,
            "slug": slugify(event, season, period, resolution)}




PAGE = "https://www.speechanddebate.org/topics/"
AGENT = "ScytheTopics/1.0 (https://github.com/joegr/scythe-web; debate evidence tool)"
OUT = Path(__file__).resolve().parent.parent / "api" / "nsda_topics.json"


class Refused(Exception):
    """The page doesn't hold what the file does; nothing was written."""


def fetch(url: str = PAGE) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": AGENT, "Accept": "text/html"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read().decode("utf-8", errors="replace")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == 3:
                raise Refused(f"couldn't fetch {url}: {e}") from e
            time.sleep(2 ** (attempt + 1))
    raise AssertionError("unreachable")


def refresh(page: str, old: list[dict]) -> tuple[list[dict], list[dict]]:
    """The page's topics, and which of them are new. Raises Refused if the page lost any of `old`."""
    new = parse(page)
    empty = [e for e in EVENTS.values() if not any(r["event"] == e for r in new)]
    if empty:
        raise Refused(f"no topics for {', '.join(empty)} on the page: has it changed shape?")
    slugs = {r["slug"] for r in new}
    lost = [r for r in old if r["slug"] not in slugs]
    if lost:
        raise Refused("these topics are no longer on the page (changed shape, or reworded?):\n"
                      + "\n".join(f"  {r['slug']}: {r['resolution']}" for r in lost))
    known = {r["slug"] for r in old}
    return new, [r for r in new if r["slug"] not in known]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Refresh api/nsda_topics.json from speechanddebate.org; only adds.")
    ap.add_argument("--html", help="parse this saved page instead of fetching it")
    ap.add_argument("--out", default=str(OUT))
    args = ap.parse_args(argv)
    path = Path(args.out)
    old = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
    try:
        rows, added = refresh(Path(args.html).read_text(encoding="utf-8") if args.html else fetch(), old)
    except Refused as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    for r in added:
        print(f"+ {r['slug']}: {r['resolution']}")
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(rows)} topics, {len(added)} new -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
