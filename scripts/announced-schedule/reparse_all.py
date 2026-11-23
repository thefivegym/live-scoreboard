
#!/usr/bin/env python3
"""Re-parse saved schedule HTML and write the announced 2027 season file."""
from __future__ import annotations
import json, os, re, sys
from datetime import datetime, timezone
from pathlib import Path
from scrape_lib import SITES, RAW, OUT, REPO, SEASON
from scrape_names import page_title
from scrape_parse import events_from_html
from scrape_merge import cluster_meets, to_season_meets
from scrape_cleanup import cleanup_meets

FILE_TO_SCHOOL = {}
for s in SITES:
    safe = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")
    FILE_TO_SCHOOL[safe + ".html"] = s
# retry folder names
FILE_TO_SCHOOL.update({
    "KentState.html": "Kent State",
    "WilliamMary.html": "William & Mary",
    "UtahState.html": "Utah State",
    "NIU.html": "Northern Illinois",
})

def school_of(path: Path):
    return FILE_TO_SCHOOL.get(path.name)

def main():
    files = list(Path(RAW).glob("*.html"))
    retry = Path("/workspace/sched2027-work/raw-retry")
    # Prefer retry copies for schools we re-fetched (Auburn decompressed, etc.)
    if retry.exists():
        for p in retry.glob("*.html"):
            s = school_of(p)
            if not s:
                continue
            # replace or add
            files = [f for f in files if school_of(f) != s]
            files.append(p)

    all_events = []
    statuses = []
    for p in sorted(files, key=lambda x: x.name):
        school = school_of(p)
        if not school:
            print("skip unknown file", p.name)
            continue
        html = p.read_text("utf-8", "replace")
        if html[:2] == "\x1f\x8b" or html.encode("latin1", "replace")[:2] == b"\x1f\x8b":
            import gzip
            html = gzip.decompress(p.read_bytes()).decode("utf-8", "replace")
        title = page_title(html)
        evs, parser, _ = events_from_html(html, school, f"https://{SITES[school]['site']}/", title)
        statuses.append({"school": school, "file": p.name, "parser": parser, "title": title, "n": len(evs)})
        all_events.extend(evs)
        print(f"  {school}: {parser} n={len(evs)} ({p.name})")

    meets = cleanup_meets(to_season_meets(cluster_meets(all_events)))
    counts = {s: 0 for s in SITES}
    for m in meets:
        for t in set(m["d1_teams"]):
            if t in counts:
                counts[t] += 1
    missing = [s for s, c in counts.items() if c == 0]
    low = [s for s, c in counts.items() if 0 < c < 6]
    high = [s for s, c in counts.items() if c > 14]

    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        "season": SEASON,
        "source": "announced school athletics schedules (Sidearm / WMT), scraped by scripts/scrape-announced-schedule",
        "meets": meets,
    }
    out = Path(OUT)
    out.mkdir(exist_ok=True)
    payload_path = out / ("2027.json" if out.name == "announced" else "2027-announced.json")
    payload_path.write_text(json.dumps(payload, indent=1) + "\n")
    # Always also write the repo announced file when the repo data dir exists.
    announced = Path(REPO) / "data" / "announced" / "2027.json"
    if announced.parent.exists() and announced != payload_path:
        announced.write_text(json.dumps(payload, indent=1) + "\n")
    (out / "status.json").write_text(json.dumps({
        "generated_at": payload["generated_at"],
        "schools": statuses,
        "meet_count": len(meets),
        "raw_event_count": len(all_events),
        "team_counts": counts,
        "missing_teams": missing,
        "low_teams": low,
        "high_teams": high,
        "first_date": meets[0]["date"] if meets else None,
        "last_date": meets[-1]["date"] if meets else None,
    }, indent=1) + "\n")
    print(f"\nMeets: {len(meets)} from {len(all_events)} school-rows")
    print(f"First {meets[0]['date'] if meets else None} last {meets[-1]['date'] if meets else None}")
    print(f"Missing ({len(missing)}): {missing}")
    print(f"Low <6: {[(s, counts[s]) for s in low]}")
    print(f"High >14: {[(s, counts[s]) for s in high]}")
    for s, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {c:2d}  {s}")

if __name__ == "__main__":
    main()
