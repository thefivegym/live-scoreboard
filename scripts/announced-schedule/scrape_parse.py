
"""Parse Sidearm NUXT, schema.org JSON-LD, and WMT HTML schedule pages."""
from __future__ import annotations
import json, re
from scrape_lib import SCHOOL_TZ
from scrape_names import (
    clean_text, canonicalize_team, is_event_title, is_exhibition,
    is_ncaa_placeholder, parse_local_dt, parse_start, to_start_utc, tz_for_location,
    in_season, page_title,
)


def split_event_name(name, school):
    """Return (ha, opponents, ev_title) from a schedule event title."""
    name = clean_text(name)
    ev_title = ""
    teams = []
    ha = "N"
    # "School vs Opponent" / "School at Opponent" / "vs Opponent" / "at Opponent"
    m = re.match(r"^(?:(.+?)\s+)?(vs\.?|at|versus)\s+(.+)$", name, re.I)
    if m:
        left, rel, right = m.group(1), m.group(2).lower(), m.group(3)
        ha = "A" if rel.startswith("at") else "H"
        # left is usually the listing school; ignore it as an opponent
        if is_event_title(right):
            ev_title = right
        else:
            c = canonicalize_team(right)
            if c and c != school:
                teams = [c]
            elif c == school and left:
                # "Opponent at School" rare
                c2 = canonicalize_team(left)
                if c2 and c2 != school:
                    teams = [c2]
                    ha = "H"
        return ha, teams, ev_title
    if is_event_title(name):
        return "N", [], name
    c = canonicalize_team(name)
    teams = [c] if c and c != school else []
    return "N", teams, ""

def raw_event(school, source_url, **kw):
    return {"school": school, "source_url": source_url, **kw}

def parse_nuxt(html: str):
    m = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None

def nuxt_resolve(data, x, seen=None):
    if seen is None:
        seen = set()
    if isinstance(x, int):
        if not (0 <= x < len(data)):
            return x
        val = data[x]
        if not isinstance(val, (dict, list)):
            return val
        if x in seen:
            return None
        seen.add(x)
        return nuxt_resolve(data, val, seen)
    if isinstance(x, list):
        if x and isinstance(x[0], str) and x[0] in {"ShallowReactive", "Reactive", "Ref", "Computed"} and len(x) >= 2:
            return nuxt_resolve(data, x[1], seen)
        if x and x[0] in {"Set", "Map"} and len(x) == 1:
            return [] if x[0] == "Set" else {}
        return [nuxt_resolve(data, i, set(seen)) for i in x]
    if isinstance(x, dict):
        return {k: nuxt_resolve(data, v, set(seen)) for k, v in x.items()}
    return x

def extract_sidearm_games(html):
    data = parse_nuxt(html)
    if not data:
        return None, None
    games = []
    season_title = None
    for i, item in enumerate(data):
        if not isinstance(item, dict) or "games" not in item or "school_name" not in item:
            continue
        sched = nuxt_resolve(data, i)
        if not isinstance(sched, dict) or not isinstance(sched.get("games"), list):
            continue
        st = (sched.get("season") or {}).get("title") or sched.get("title") or ""
        season_title = st
        for g in sched["games"]:
            if isinstance(g, dict) and (g.get("date") or g.get("opponent") or g.get("event_name")):
                games.append(g)
    if games:
        return games, season_title
    return None, None

def from_sidearm_game(school, source_url, g):
    date_s = g.get("date") or g.get("start_date") or ""
    time_s = g.get("time") or ""
    tbd = g.get("tbd") or g.get("is_tdb") or False
    loc = g.get("location") or ""
    li = (g.get("location_indicator") or "").upper()
    at_vs = (g.get("at_vs") or g.get("atVs") or "").lower()
    tour_raw = g.get("tournament") or ""
    if isinstance(tour_raw, dict):
        tour_raw = tour_raw.get("title") or tour_raw.get("name") or ""
    tournament = clean_text(tour_raw)
    ev_raw = g.get("event_name") or ""
    if isinstance(ev_raw, dict):
        ev_raw = ev_raw.get("title") or ev_raw.get("name") or ""
    event_name = clean_text(ev_raw)
    typ = g.get("type") or ""
    fac = g.get("facility")
    venue = ""
    if isinstance(fac, dict):
        venue = clean_text(fac.get("title") or "")
    elif isinstance(fac, str):
        venue = clean_text(fac)
    opp = g.get("opponent") or {}
    if isinstance(opp, dict):
        opp_title = clean_text(opp.get("title") or opp.get("name") or "")
    else:
        opp_title = clean_text(opp or "")
    opps = []
    raw_opps = g.get("opponents") or []
    if isinstance(raw_opps, list):
        for o in raw_opps:
            t = clean_text((o.get("title") or o.get("name") or "") if isinstance(o, dict) else o)
            if t:
                opps.append(t)
    names = []
    ev_title = tournament or event_name
    for t in [opp_title, *opps]:
        if not t:
            continue
        if is_event_title(t):
            ev_title = ev_title or t
        else:
            names.append(t)
    ev_title = ev_title or ""
    ha = "N"
    if li == "N":
        ha = "N"
    elif li == "A" or at_vs == "at":
        ha = "A"
    elif li == "H" or at_vs == "vs":
        ha = "H"
    tzname = tz_for_location(loc, school)
    parsed = parse_start(date_s, None if tbd else time_s, tzname)
    if not parsed:
        return []
    ymd, start_utc, time_et = parsed
    if tbd:
        start_utc, time_et = None, None
    blob = " ".join([ev_title, typ, opp_title])
    if is_exhibition(blob, typ, ymd):
        return []
    if is_ncaa_placeholder(ev_title or opp_title):
        return []
    if not in_season(ymd, ev_title or opp_title):
        return []
    teams = []
    for n in names:
        c = canonicalize_team(n)
        if c:
            teams.append(c)
    return [raw_event(
        school, source_url,
        date=ymd, start_utc=start_utc, time_et=time_et, has_time=bool(start_utc),
        location=clean_text(loc), venue=venue, ha=ha,
        opponents=teams, desc=clean_text(ev_title), typ=str(typ or ""),
        raw_opponent=opp_title, raw_id=g.get("id"),
    )]

def parse_ldjson_events(html, school, source_url):
    out = []
    for m in re.finditer(r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.S | re.I):
        try:
            data = json.loads(m.group(1).strip())
        except Exception:
            continue
        items = data if isinstance(data, list) else [data]
        more = []
        for it in items:
            if isinstance(it, dict) and "@graph" in it:
                more.extend(it["@graph"])
            else:
                more.append(it)
        for it in more:
            if not isinstance(it, dict):
                continue
            typ = it.get("@type")
            if typ not in ("Event", "SportsEvent") and typ != ["Event"] and typ != ["SportsEvent"]:
                continue
            name = clean_text(it.get("name") or "")
            start = it.get("startDate") or it.get("start") or ""
            loc = it.get("location")
            loc_s = ""
            if isinstance(loc, dict):
                addr = loc.get("address")
                loc_s = clean_text(loc.get("name") or (addr.get("name") if isinstance(addr, dict) else addr) or "")
            elif isinstance(loc, str):
                loc_s = clean_text(loc)
            ha, teams, ev_title = split_event_name(name, school)
            if is_event_title(name) and not ev_title:
                ev_title = name
            tzname = tz_for_location(loc_s, school)
            parsed = parse_start(start, "", tzname)
            if not parsed:
                continue
            ymd, start_utc, time_et = parsed
            if is_exhibition(name, None, ymd) or is_ncaa_placeholder(ev_title or name):
                continue
            if not in_season(ymd, ev_title or name):
                continue
            out.append(raw_event(
                school, source_url,
                date=ymd, start_utc=start_utc, time_et=time_et, has_time=bool(start_utc),
                location=loc_s, venue="", ha=ha,
                opponents=teams, desc=clean_text(ev_title), typ="",
                raw_opponent=name, raw_id=None,
            ))
    return out

def parse_arkansas_like(html, school, source_url):
    out = []
    pattern = re.compile(
        r'<div class="type\s+(?P<typ>[^"]+)">\s*(?P<typtxt>[^<]+)</div>\s*'
        r'<div class="date">\s*<span class="month">\s*(?P<dow>[^<]*?)<strong>(?P<md>[^<]+)</strong>\s*</span>\s*'
        r'<span class="time">\s*(?P<time>[^<]*)</span>\s*</div>\s*'
        r'<div class="place">\s*(?P<place>[^<]*)\s*</div>',
        re.S,
    )
    opp_re = re.compile(r'<div class="opponent">\s*<span>\s*(?P<opp>.*?)\s*</span>', re.S)
    marks = []
    for m in pattern.finditer(html):
        marks.append(("date", m.start(), m))
    for m in opp_re.finditer(html):
        marks.append(("opp", m.start(), m))
    marks.sort(key=lambda x: x[1])
    pending = None
    for kind, _, m in marks:
        if kind == "date":
            pending = m
        elif kind == "opp" and pending is not None:
            typ = pending.group("typ").strip().lower()
            md = clean_text(pending.group("md"))
            tm = clean_text(pending.group("time"))
            place = clean_text(pending.group("place"))
            opp = clean_text(re.sub(r"<[^>]+>", " ", m.group("opp")))
            opp = re.sub(r"^(at|vs\.?)\s+", "", opp, flags=re.I)
            pending = None
            ev_title = opp if is_event_title(opp) else ""
            teams = [] if ev_title else ([canonicalize_team(opp)] if canonicalize_team(opp) else [])
            ha = "H" if typ.startswith("home") else "A" if typ.startswith("away") else "N"
            tzname = tz_for_location(place, school)
            if ha == "H":
                tzname = SCHOOL_TZ.get(school, tzname)
            parsed = parse_start(md, tm, tzname)
            if not parsed:
                continue
            ymd, start_utc, time_et = parsed
            if is_exhibition(opp, typ, ymd) or is_ncaa_placeholder(opp):
                continue
            if not in_season(ymd, ev_title or opp):
                continue
            out.append(raw_event(
                school, source_url,
                date=ymd, start_utc=start_utc, time_et=time_et, has_time=bool(start_utc),
                location=place, venue=place if ha == "H" else "", ha=ha,
                opponents=teams, desc=clean_text(ev_title), typ=typ,
                raw_opponent=opp, raw_id=None,
            ))
    return out

def parse_wmt_items(html, school, source_url):
    out = []
    for m in re.finditer(
        r'<div class="schedule__item schedule-item\s+(?P<ha>home|away|neutral)?[^"]*"(.*?)</div>\s*</div>\s*</div>',
        html, re.S | re.I,
    ):
        block = m.group(0)
        ha_c = (m.group("ha") or "").lower()
        time_el = re.search(r"<time>\s*<span>([^<]*)</span>\s*<span>([^<]*)</span>", block, re.S)
        if not time_el:
            continue
        md = clean_text(time_el.group(2))
        team = re.search(r'<div class="schedule-item__team">\s*<h3>\s*([^<]+)', block, re.S)
        place = re.search(r"<p>([^<]+)</p>", block)
        result = re.search(r'class="schedule-item__result">\s*([^<]+)', block, re.S)
        prefix = re.search(r'class="prefix">\s*([^<]+)', block)
        name = clean_text(team.group(1) if team else "")
        loc = clean_text(place.group(1) if place else "")
        tm = clean_text(result.group(1) if result else "")
        if tm and not re.search(r"(am|pm|a\.m|p\.m|tba|tbd|:)", tm, re.I):
            tm = ""
        ev_title = name if is_event_title(name) else ""
        teams = [] if ev_title else ([canonicalize_team(name)] if canonicalize_team(name) else [])
        pref = clean_text(prefix.group(1) if prefix else "")
        ha = "H" if ha_c == "home" or pref.lower().startswith("vs") else "A" if ha_c == "away" or pref.lower().startswith("at") else "N"
        if ha_c == "neutral":
            ha = "N"
        tzname = tz_for_location(loc, school)
        parsed = parse_start(md, tm, tzname)
        if not parsed:
            continue
        ymd, start_utc, time_et = parsed
        if is_exhibition(name, None, ymd) or is_ncaa_placeholder(name):
            continue
        if not in_season(ymd, ev_title or name):
            continue
        out.append(raw_event(
            school, source_url,
            date=ymd, start_utc=start_utc, time_et=time_et, has_time=bool(start_utc),
            location=loc, venue="", ha=ha,
            opponents=teams, desc=clean_text(ev_title), typ=ha_c,
            raw_opponent=name, raw_id=None,
        ))
    return out

def events_from_html(html, school, source_url, title=""):
    games, season_title = extract_sidearm_games(html)
    if games:
        events = []
        for g in games:
            events.extend(from_sidearm_game(school, source_url, g))
        return events, "sidearm-nuxt", season_title or title
    ark = parse_arkansas_like(html, school, source_url)
    if len(ark) >= 3:
        return ark, "arkansas-html", title
    ld = parse_ldjson_events(html, school, source_url)
    wmt = parse_wmt_items(html, school, source_url)
    if len(wmt) >= len(ld) and len(wmt) >= 3:
        return wmt, "wmt-html", title
    if len(ld) >= 3:
        return ld, "ld+json", title
    if wmt:
        return wmt, "wmt-html", title
    if ld:
        return ld, "ld+json", title
    if ark:
        return ark, "arkansas-html", title
    return [], "none", title
