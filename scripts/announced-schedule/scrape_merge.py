
"""Cluster per-school rows into deduplicated meets and emit season-file shape."""
from __future__ import annotations
import re
from collections import defaultdict
from datetime import datetime
from scrape_lib import D1_SET
from scrape_names import is_event_title, is_conf_champ

def should_merge(a, b):
    if a["date"] != b["date"]:
        return False
    ta, tb = set(a["teams"]), set(b["teams"])
    shared = ta & tb
    da, db = (a.get("desc") or "").lower(), (b.get("desc") or "").lower()
    def norm_desc(s):
        s = re.sub(r"20\d{2}", "", s)
        s = re.sub(r"[^a-z0-9]+", " ", s).strip()
        return s
    nda, ndb = norm_desc(da), norm_desc(db)
    if nda and ndb and (nda == ndb or nda in ndb or ndb in nda) and len(nda) >= 8:
        return True
    if len(shared) >= 1:
        return True
    if False:  # kept to preserve structure; shared-team already returned
        if a.get("start_utc") and b.get("start_utc"):
            try:
                da_ = datetime.fromisoformat(a["start_utc"].replace("Z", "+00:00"))
                db_ = datetime.fromisoformat(b["start_utc"].replace("Z", "+00:00"))
                if abs((da_ - db_).total_seconds()) <= 3600:
                    return True
            except Exception:
                pass
        else:
            la, lb = (a.get("location") or "").lower(), (b.get("location") or "").lower()
            if la and lb and (re.split(r"[,|]", la)[0].strip() in lb or re.split(r"[,|]", lb)[0].strip() in la):
                return True
            if ta == tb:
                return True
            return True
        la, lb = (a.get("location") or "").lower(), (b.get("location") or "").lower()
        if la and lb and (re.split(r"[,|]", la)[0].strip() in lb or re.split(r"[,|]", lb)[0].strip() in la):
            return True
        if ta == tb:
            return True
    return False

def cluster_meets(raw_events):
    prov = []
    for e in raw_events:
        teams = [e["school"]] + list(e.get("opponents") or [])
        seen = set(); t2 = []
        for t in teams:
            if t and t not in seen:
                seen.add(t); t2.append(t)
        home, away = [], []
        ha = e.get("ha") or "N"
        if ha == "H":
            home = [e["school"]]
            away = [t for t in t2 if t != e["school"]]
        elif ha == "A":
            opps = [t for t in t2 if t != e["school"]]
            if len(opps) == 1:
                home = opps
                away = [e["school"]]
            else:
                home, away = [], t2
        else:
            home, away = [], t2
        prov.append({
            "date": e["date"],
            "start_utc": e.get("start_utc"),
            "time_et": e.get("time_et"),
            "location": e.get("location") or "",
            "venue": e.get("venue") or "",
            "desc": e.get("desc") or "",
            "home": home,
            "away": away,
            "teams": t2,
            "sources": [e["source_url"]],
            "schools": [e["school"]],
        })
    n = len(prov)
    parent = list(range(n))
    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri
    by_date = defaultdict(list)
    for i, p in enumerate(prov):
        by_date[p["date"]].append(i)
    for idxs in by_date.values():
        for a in range(len(idxs)):
            for b in range(a + 1, len(idxs)):
                i, j = idxs[a], idxs[b]
                if should_merge(prov[i], prov[j]):
                    union(i, j)
    groups = defaultdict(list)
    for i in range(n):
        groups[find(i)].append(prov[i])
    meets = []
    for g in groups.values():
        teams = []
        seen = set()
        for p in g:
            for t in p["teams"]:
                if t not in seen:
                    seen.add(t); teams.append(t)
        homes = []
        hseen = set()
        for p in g:
            for t in p["home"]:
                if t not in hseen:
                    hseen.add(t); homes.append(t)
        desc = ""
        for p in g:
            if p["desc"] and (not desc or len(p["desc"]) > len(desc)):
                desc = p["desc"]
        timed = [p for p in g if p.get("start_utc")]
        start_utc = time_et = None
        if timed:
            timed.sort(key=lambda p: p["start_utc"])
            start_utc = timed[0]["start_utc"]
            time_et = timed[0]["time_et"]
        loc = venue = ""
        for p in g:
            if p["location"] and (not loc or len(p["location"]) > len(loc)):
                loc = p["location"]
            if p["venue"] and not venue:
                venue = p["venue"]
        sources = []
        for p in g:
            for s in p["sources"]:
                if s not in sources:
                    sources.append(s)
        if desc and (is_event_title(desc) or is_conf_champ(desc)):
            if is_conf_champ(desc) or re.search(r"invitational|challenge|classic|quad|ncaa|championship", desc, re.I):
                homes = []
        away = [t for t in teams if t not in homes]
        meets.append({
            "date": g[0]["date"],
            "start_utc": start_utc,
            "time_et": time_et,
            "desc": desc,
            "home": homes,
            "away": away,
            "location": loc,
            "venue": venue,
            "sources": sources,
            "teams": teams,
        })
    return meets

def to_season_meets(meets):
    out = []
    for m in meets:
        teams = m["teams"]
        d1 = [t for t in (m["home"] + m["away"]) if t in D1_SET]
        for t in teams:
            if t in D1_SET and t not in d1:
                d1.append(t)
        if not d1:
            continue
        slug_teams = "-".join(re.sub(r"[^a-z0-9]+", "", t.lower()) for t in sorted(d1))
        if m["desc"]:
            slug = re.sub(r"[^a-z0-9]+", "-", m["desc"].lower()).strip("-")[:40]
            mid = f"ann-{m['date']}-{slug}"
        else:
            mid = f"ann-{m['date']}-{slug_teams}"
        out.append({
            "id": mid,
            "date": m["date"],
            "time_et": m["time_et"],
            "start_utc": m["start_utc"],
            "desc": m["desc"] or "",
            "home": m["home"],
            "away": m["away"],
            "d1_teams": d1,
            "virtius": None,
            "stats_link": None,
            "video_link": None,
            "video_desc": None,
            "rtn_url": None,
            "location": m.get("location") or None,
            "venue": m.get("venue") or None,
            "sources": m.get("sources") or [],
        })
    seen = {}
    for m in out:
        if m["id"] in seen:
            seen[m["id"]] += 1
            m["id"] = m["id"] + f"-{seen[m['id']]}"
        else:
            seen[m["id"]] = 1
    out.sort(key=lambda m: (m["date"], m["time_et"] or "99", ",".join(m["d1_teams"])))
    return out
