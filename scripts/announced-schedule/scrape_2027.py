
#!/usr/bin/env python3
"""Scrape announced 2026-27 NCAA D1 women's gymnastics regular-season meets."""
from __future__ import annotations
import json, os, re, sys, concurrent.futures
from datetime import datetime, timezone
from urllib.parse import urlparse
from scrape_lib import (
    SITES, DEFAULT_PATHS, RAW, OUT, REPO, SEASON, SEASON_START, PARALLEL,
)
from scrape_http import polite_fetch, load_robots, robots_allows
from scrape_names import title_season, page_title
from scrape_parse import events_from_html
from scrape_merge import cluster_meets, to_season_meets
from scrape_cleanup import cleanup_meets

def candidate_urls(school, info):
    origin = "https://" + info["site"]
    urls = []
    paths = list(info.get("paths") or []) + list(DEFAULT_PATHS)
    extra = []
    for p in paths:
        if "2026-27" not in p:
            extra.append(p.rstrip("/") + "/2026-27")
            extra.append(p.rstrip("/") + "/2026-27/")
    seen = set()
    for p in extra + paths:
        if not p.startswith("/"):
            p = "/" + p
        url = origin + p
        if url not in seen:
            urls.append(url)
            seen.add(url)
    return origin, urls

def scrape_school(school, info):
    origin, urls = candidate_urls(school, info)
    rules = load_robots(origin)
    status = {"school": school, "ok": False, "url": None, "parser": None, "title": None,
              "season": None, "n_raw": 0, "n_kept": 0, "error": None, "http": None}
    last_err = None
    tried = []
    empty_2027 = None
    for url in urls:
        path = urlparse(url).path
        if not robots_allows(rules, path):
            tried.append(url + " [robots disallowed]")
            continue
        r = polite_fetch(url)
        tried.append(f"{url} -> {r['status']}")
        if not r["ok"]:
            last_err = r["error"] or f"HTTP {r['status']}"
            continue
        body = r["body"]
        if len(body) < 2000:
            last_err = f"short body {len(body)}"
            continue
        html = body.decode("utf-8", "replace")
        title = page_title(html)
        if re.search(r"page not found|404", title or "", re.I):
            last_err = "404 title"
            continue
        evs, parser, _ = events_from_html(html, school, r["url"], title)
        seas = title_season(title)
        years = {e["date"][:4] for e in evs} if evs else set()
        if evs and ("2027" in years or seas == 2027 or any(e["date"] >= SEASON_START for e in evs)):
            safe = re.sub(r"[^A-Za-z0-9]+", "-", school).strip("-")
            with open(os.path.join(RAW, safe + ".html"), "wb") as f:
                f.write(body)
            status.update(ok=True, url=r["url"], parser=parser, title=title, season=seas,
                          n_raw=len(evs), n_kept=len(evs), http=r["status"])
            return evs, status
        if evs and seas and seas < 2027 and "2027" not in years:
            last_err = f"page looks like season {seas}"
            continue
        if evs:
            safe = re.sub(r"[^A-Za-z0-9]+", "-", school).strip("-")
            with open(os.path.join(RAW, safe + ".html"), "wb") as f:
                f.write(body)
            status.update(ok=True, url=r["url"], parser=parser, title=title, season=seas,
                          n_raw=len(evs), n_kept=len(evs), http=r["status"])
            return evs, status
        # A 2027-titled page with zero parsed meets may be a thin season slug;
        # keep looking at the remaining URLs before giving up.
        if seas == 2027 or (title and "2027" in title):
            last_err = f"2027 page parsed but no regular-season meets kept ({parser}); title={title!r}"
            empty_2027 = (html, r, parser, title, seas)
            continue
        last_err = f"no events ({parser}); title={title!r}"
    if empty_2027:
        html, r, parser, title, seas = empty_2027
        safe = re.sub(r"[^A-Za-z0-9]+", "-", school).strip("-")
        with open(os.path.join(RAW, safe + ".html"), "wb") as f:
            f.write(html.encode("utf-8", "replace") if isinstance(html, str) else html)
        status.update(ok=True, url=r["url"], parser=parser or "empty", title=title, season=seas,
                      n_raw=0, n_kept=0, http=r["status"],
                      error=last_err or "2027 page parsed but no regular-season meets kept", tried=tried)
        return [], status
    status.update(error=last_err or "no usable page", tried=tried)
    return [], status

def main():
    only = set()
    for a in sys.argv[1:]:
        if a.startswith("--only="):
            only = {x.strip() for x in a.split("=", 1)[1].split(",") if x.strip()}
    schools = list(SITES.keys())
    if only:
        schools = [s for s in schools if s in only]
        missing = only - set(schools)
        if missing:
            print("unknown schools", missing)

    print(f"Scraping {len(schools)} schools (parallel={PARALLEL})...")
    all_events = []
    statuses = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=PARALLEL) as ex:
        futs = {ex.submit(scrape_school, s, SITES[s]): s for s in schools}
        for fut in concurrent.futures.as_completed(futs):
            s = futs[fut]
            try:
                evs, st = fut.result()
            except Exception as e:
                evs, st = [], {"school": s, "ok": False, "error": repr(e)}
            statuses.append(st)
            all_events.extend(evs)
            print(f"  {s}: {'OK' if st.get('ok') else 'FAIL'} parser={st.get('parser')} n={st.get('n_kept', 0)} url={st.get('url')} err={st.get('error')}")

    statuses.sort(key=lambda x: x["school"])
    meets_raw = cluster_meets(all_events)
    meets = cleanup_meets(to_season_meets(meets_raw))

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
    out_name = "2027.json" if os.path.basename(OUT) == "announced" else "2027-announced.json"
    with open(os.path.join(OUT, out_name), "w") as f:
        json.dump(payload, f, indent=1)
        f.write("\n")
    announced = os.path.join(REPO, "data", "announced", "2027.json")
    if os.path.isdir(os.path.dirname(announced)) and os.path.abspath(announced) != os.path.abspath(os.path.join(OUT, out_name)):
        with open(announced, "w") as f:
            json.dump(payload, f, indent=1)
            f.write("\n")
    with open(os.path.join(OUT, "status.json"), "w") as f:
        json.dump({
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
        }, f, indent=1)
        f.write("\n")

    print(f"\nMeets: {len(meets)} from {len(all_events)} school-rows")
    print(f"First {meets[0]['date'] if meets else None} last {meets[-1]['date'] if meets else None}")
    print(f"Teams with 0 meets ({len(missing)}): {missing}")
    print(f"Teams with <6 meets: {[(s, counts[s]) for s in low]}")
    print(f"Teams with >14 meets: {[(s, counts[s]) for s in high]}")
    for s, c in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {c:2d}  {s}")

if __name__ == "__main__":
    main()
