
"""Final cleanup of announced meets: championships merge, placeholders, promo titles."""
from __future__ import annotations
import re
from collections import defaultdict
from scrape_lib import D1_SET, ALIAS_N
from scrape_names import canonicalize_team, is_ncaa_placeholder, is_conf_champ, clean_text

PROMO_DESC = re.compile(
    r"youth day|calendar giveaway|cherry out|family night|galentine|purple day|"
    r"celebration|senior meet|white out|color it|love island|dancing with",
    re.I,
)
EXHIB_TITLE = re.compile(r"carolina debut|green & gold|blue & gold|black & gold|preview meet", re.I)

CONF_PATTS = [
    (re.compile(r"\bsec\b", re.I), "SEC Championship"),
    (re.compile(r"\bbig ten\b|\bb1g\b", re.I), "Big Ten Championship"),
    (re.compile(r"\bbig 12\b|\bbig xii\b", re.I), "Big 12 Championship"),
    (re.compile(r"\bacc\b", re.I), "ACC Championship"),
    (re.compile(r"\bmac\b|mid-american", re.I), "MAC Championship"),
    (re.compile(r"\beagl\b", re.I), "EAGL Championship"),
    (re.compile(r"\bmpsf\b", re.I), "MPSF Championship"),
    (re.compile(r"\bgec\b|ivy classic", re.I), "GEC Championship"),
    (re.compile(r"\bmic\b", re.I), "MIC Championship"),
    (re.compile(r"mountain west|\bmw\b", re.I), "Mountain West Championship"),
    (re.compile(r"\bpac-?12\b", re.I), "Pac-12 Championship"),
]

def _norm_team_list(lst):
    out, seen = [], set()
    for t in lst or []:
        c = canonicalize_team(t) or t
        if c and c not in seen:
            seen.add(c); out.append(c)
    return out

def _conf_label(meet):
    blob = " ".join(filter(None, [meet.get("desc"), meet.get("location"), " ".join(meet.get("d1_teams") or [])]))
    for rx, title in CONF_PATTS:
        if rx.search(meet.get("desc") or "") or (is_conf_champ(meet.get("desc") or "") and rx.search(blob)):
            return title
    # location-only hints during championship weekend
    loc = (meet.get("location") or "").lower()
    desc = (meet.get("desc") or "").lower()
    if "championship" in desc or "tournament" in desc or "champs" in desc:
        for rx, title in CONF_PATTS:
            if rx.search(desc):
                return title
    return None

def cleanup_meets(meets):
    cleaned = []
    for m in meets:
        # remap team names
        m["home"] = _norm_team_list(m.get("home"))
        m["away"] = _norm_team_list(m.get("away"))
        # drop dups between home/away
        homes = set(m["home"])
        m["away"] = [t for t in m["away"] if t not in homes]
        m["d1_teams"] = [t for t in (m["home"] + m["away"]) if t in D1_SET]
        desc = m.get("desc") or ""
        if PROMO_DESC.search(desc):
            m["desc"] = ""
            desc = ""
        if EXHIB_TITLE.search(desc) or any(EXHIB_TITLE.search(t) for t in m["home"]+m["away"]):
            continue
        if is_ncaa_placeholder(desc) or (m["date"] >= "2027-03-31" and re.search(r"ncaa", desc, re.I)):
            continue
        # odd minutes -> TBA (keep :00/:15/:30/:45)
        te = m.get("time_et") or ""
        if te and len(te) >= 5 and te[3:5] not in ("00", "15", "30", "45"):
            m["time_et"] = None
            m["start_utc"] = None
        if not m["d1_teams"]:
            continue
        cleaned.append(m)

    # Merge conference championships on Mar 18-21 by label or city
    weekend = [m for m in cleaned if "2027-03-18" <= m["date"] <= "2027-03-22"]
    others = [m for m in cleaned if m not in weekend]

    def city(m):
        loc = (m.get("location") or "").lower()
        return re.split(r"[,|–-]", loc)[0].strip()

    groups = {}
    singles = []
    for m in weekend:
        label = _conf_label(m)
        key = None
        if label:
            key = ("conf", label)
        else:
            c = city(m)
            # attach unlabeled same-city leftover to a labeled group later
            key = ("city", c) if c else None
        if not key:
            singles.append(m)
            continue
        groups.setdefault(key, []).append(m)

    # fold city groups into conf groups when a conf meet is in that city
    conf_cities = {}
    for (kind, label), ms in list(groups.items()):
        if kind == "conf":
            for m in ms:
                conf_cities[city(m)] = ("conf", label)

    merged_weekend = []
    used = set()
    for key, ms in groups.items():
        if key[0] == "city" and key[1] in conf_cities:
            groups[conf_cities[key[1]]].extend(ms)
            used.add(key)
    for key, ms in groups.items():
        if key in used:
            continue
        if len(ms) == 1 and key[0] == "city":
            merged_weekend.extend(ms)
            continue
        # merge
        teams, homes, sources = [], [], []
        seent, seenh, seens = set(), set(), set()
        desc = ""
        loc = venue = ""
        start_utc = time_et = None
        date = min(m["date"] for m in ms)
        for m in ms:
            if key[0] == "conf":
                desc = key[1]
            elif m.get("desc") and (not desc or len(m["desc"]) > len(desc)):
                desc = m["desc"]
            if m.get("start_utc") and (not start_utc or m["start_utc"] < start_utc):
                start_utc, time_et = m["start_utc"], m["time_et"]
            if m.get("location") and (not loc or len(m["location"]) > len(loc)):
                loc = m["location"]
            if m.get("venue") and not venue:
                venue = m["venue"]
            for t in m["home"] + m["away"]:
                if t not in seent:
                    seent.add(t); teams.append(t)
            for s in m.get("sources") or []:
                if s not in seens:
                    seens.add(s); sources.append(s)
        d1 = [t for t in teams if t in D1_SET]
        merged_weekend.append({
            "id": None,
            "date": date,
            "time_et": time_et,
            "start_utc": start_utc,
            "desc": desc,
            "home": [],
            "away": teams,
            "d1_teams": d1,
            "virtius": None, "stats_link": None, "video_link": None, "video_desc": None, "rtn_url": None,
            "location": loc or None, "venue": venue or None, "sources": sources,
        })
    merged_weekend.extend(singles)

    out = others + merged_weekend
    # re-id
    seen = {}
    for m in out:
        d1 = m.get("d1_teams") or [t for t in (m.get("home") or []) + (m.get("away") or []) if t in D1_SET]
        m["d1_teams"] = d1
        if m.get("desc"):
            slug = re.sub(r"[^a-z0-9]+", "-", m["desc"].lower()).strip("-")[:40]
            mid = f"ann-{m['date']}-{slug}"
        else:
            slug_teams = "-".join(re.sub(r"[^a-z0-9]+", "", t.lower()) for t in sorted(d1))
            mid = f"ann-{m['date']}-{slug_teams}"
        if mid in seen:
            seen[mid] += 1
            mid = f"{mid}-{seen[mid]}"
        else:
            seen[mid] = 1
        m["id"] = mid
    out.sort(key=lambda m: (m["date"], m["time_et"] or "99", ",".join(m["d1_teams"])))
    return out
