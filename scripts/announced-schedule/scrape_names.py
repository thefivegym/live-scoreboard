
"""Team names, event classification, dates and timezones."""
from __future__ import annotations
import re, html as htmlmod
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from scrape_lib import (
    D1_SET, ALIAS_N, SCHOOL_TZ, SEASON_START, SEASON_END, CONF_CHAMP_END,
)

EVENT_NAME_RE = re.compile(
    r"(championships?|invitational|classic|challenge|quad\b|tri[-\s]?meet|"
    r"regionals?|ncaa|conference\s*(finals?|meet|championships?)|"
    r"preview|exhibition|showcase|intrasquad|intra[-\s]?squad|scrimmage|"
    r"fan fest|couture|spotlight|chalk\s*&\s*chomp|best of utah|"
    r"metroplex|windy city|elevate the stage|unite for her|purple\s*&\s*gold|"
    r"hbcu|gymback)",
    re.I,
)
EXHIB_RE = re.compile(
    r"intrasquad|intra[-\s]?squad|exhibition|showcase|scrimmage|"
    r"chalk\s*&\s*chomp|crimson couture|sooner(?:s)?\s*spotlight|"
    r"red rocks preview|fan fest|gymback preview|(?<!ncaa )preview(?:\s+meet)?\b|"
    r"crimson and white|intra squad|"
    r"black\s*&\s*gold|green\s*&\s*gold|blue\s*&\s*gold|"
    r"maroon\s*&\s*gold|cardinal\s*&\s*gold|crimson\s*&\s*cream",
    re.I,
)
NCAA_PLACEHOLDER_RE = re.compile(r"\bncaa\b.*(regional|championship|national)", re.I)
CONF_CHAMP_RE = re.compile(
    r"\b(sec|big ten|big 12|big xii|acc|mac|eagl|mpsf|gec|mic|mountain west|mw|pac-?12|wcgnic).*\bchampionship",
    re.I,
)

STATE_TZ = {
    "ala": "America/Chicago", "al": "America/Chicago", "alabama": "America/Chicago",
    "alaska": "America/Anchorage", "ak": "America/Anchorage",
    "ariz": "America/Phoenix", "az": "America/Phoenix", "arizona": "America/Phoenix",
    "ark": "America/Chicago", "ar": "America/Chicago", "arkansas": "America/Chicago",
    "calif": "America/Los_Angeles", "ca": "America/Los_Angeles", "california": "America/Los_Angeles",
    "colo": "America/Denver", "co": "America/Denver", "colorado": "America/Denver",
    "conn": "America/New_York", "ct": "America/New_York", "connecticut": "America/New_York",
    "d.c": "America/New_York", "dc": "America/New_York",
    "del": "America/New_York", "de": "America/New_York",
    "fla": "America/New_York", "fl": "America/New_York", "florida": "America/New_York",
    "ga": "America/New_York", "georgia": "America/New_York",
    "hawaii": "Pacific/Honolulu", "hi": "Pacific/Honolulu",
    "idaho": "America/Boise", "id": "America/Boise",
    "ill": "America/Chicago", "il": "America/Chicago", "illinois": "America/Chicago",
    "ind": "America/Indiana/Indianapolis", "in": "America/Indiana/Indianapolis", "indiana": "America/Indiana/Indianapolis",
    "iowa": "America/Chicago", "ia": "America/Chicago",
    "kan": "America/Chicago", "ks": "America/Chicago", "kansas": "America/Chicago",
    "ky": "America/New_York", "kentucky": "America/New_York",
    "la": "America/Chicago", "louisiana": "America/Chicago",
    "maine": "America/New_York", "me": "America/New_York",
    "md": "America/New_York", "maryland": "America/New_York",
    "mass": "America/New_York", "ma": "America/New_York", "massachusetts": "America/New_York",
    "mich": "America/New_York", "mi": "America/New_York", "michigan": "America/New_York",
    "minn": "America/Chicago", "mn": "America/Chicago", "minnesota": "America/Chicago",
    "miss": "America/Chicago", "ms": "America/Chicago", "mississippi": "America/Chicago",
    "mo": "America/Chicago", "missouri": "America/Chicago",
    "mont": "America/Denver", "mt": "America/Denver",
    "neb": "America/Chicago", "ne": "America/Chicago", "nebraska": "America/Chicago",
    "nev": "America/Los_Angeles", "nv": "America/Los_Angeles",
    "n.h": "America/New_York", "nh": "America/New_York",
    "n.j": "America/New_York", "nj": "America/New_York",
    "n.m": "America/Denver", "nm": "America/Denver",
    "n.y": "America/New_York", "ny": "America/New_York",
    "n.c": "America/New_York", "nc": "America/New_York",
    "n.d": "America/Chicago", "nd": "America/Chicago",
    "ohio": "America/New_York", "oh": "America/New_York",
    "okla": "America/Chicago", "ok": "America/Chicago", "oklahoma": "America/Chicago",
    "ore": "America/Los_Angeles", "or": "America/Los_Angeles", "oregon": "America/Los_Angeles",
    "pa": "America/New_York", "pennsylvania": "America/New_York",
    "r.i": "America/New_York", "ri": "America/New_York",
    "s.c": "America/New_York", "sc": "America/New_York",
    "s.d": "America/Chicago", "sd": "America/Chicago",
    "tenn": "America/Chicago", "tn": "America/Chicago", "tennessee": "America/Chicago",
    "texas": "America/Chicago", "tx": "America/Chicago", "tex": "America/Chicago",
    "utah": "America/Denver", "ut": "America/Denver",
    "vt": "America/New_York", "vermont": "America/New_York",
    "va": "America/New_York", "virginia": "America/New_York",
    "wash": "America/Los_Angeles", "wa": "America/Los_Angeles", "washington": "America/Los_Angeles",
    "w.va": "America/New_York", "wv": "America/New_York",
    "wis": "America/Chicago", "wi": "America/Chicago", "wisconsin": "America/Chicago",
    "wyo": "America/Denver", "wy": "America/Denver",
}
CITY_TZ = {
    "gainesville": "America/New_York", "tuscaloosa": "America/Chicago", "baton rouge": "America/Chicago",
    "fayetteville": "America/Chicago", "lexington": "America/New_York", "athens": "America/New_York",
    "norman": "America/Chicago", "fort worth": "America/Chicago", "dallas": "America/Chicago",
    "denton": "America/Chicago", "greenville": "America/New_York", "tampa": "America/New_York",
    "orlando": "America/New_York", "minneapolis": "America/Chicago", "st. paul": "America/Chicago",
    "los angeles": "America/Los_Angeles", "berkeley": "America/Los_Angeles", "stanford": "America/Los_Angeles",
    "corvallis": "America/Los_Angeles", "seattle": "America/Los_Angeles", "salt lake city": "America/Denver",
    "provo": "America/Denver", "logan": "America/Denver", "denver": "America/Denver", "boise": "America/Boise",
    "tempe": "America/Phoenix", "tucson": "America/Phoenix", "anchorage": "America/Anchorage",
    "ann arbor": "America/New_York", "east lansing": "America/New_York", "columbus": "America/New_York",
    "university park": "America/New_York", "college park": "America/New_York", "chapel hill": "America/New_York",
    "raleigh": "America/New_York", "pittsburgh": "America/New_York", "philadelphia": "America/New_York",
    "new haven": "America/New_York", "tallahassee": "America/New_York", "auburn": "America/Chicago",
    "iowa city": "America/Chicago", "ames": "America/Chicago", "lincoln": "America/Chicago",
    "champaign": "America/Chicago", "normal": "America/Chicago", "cape girardeau": "America/Chicago",
    "kalamazoo": "America/New_York", "mount pleasant": "America/New_York", "ypsilanti": "America/New_York",
    "dekalb": "America/Chicago", "bowling green": "America/New_York", "kent": "America/New_York",
    "muncie": "America/Indiana/Indianapolis", "sacramento": "America/Los_Angeles",
    "san jose": "America/Los_Angeles", "davis": "America/Los_Angeles", "cedar city": "America/Denver",
    "williamsburg": "America/New_York", "brooklyn": "America/New_York", "colorado springs": "America/Denver",
}

def clean_text(s):
    if s is None:
        return ""
    if not isinstance(s, str):
        s = str(s)
    s = htmlmod.unescape(s).replace("\u00a0", " ").replace("\u2019", "'").replace("\u2018", "'")
    s = re.sub(r"<[^>]+>", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

def canonicalize_team(name: str, allow_unknown=True):
    n = clean_text(name)
    if not n:
        return None
    n = re.sub(r"^(at|vs\.?|versus|v\.)\s+", "", n, flags=re.I)
    n = re.sub(r"^#\d+\s*", "", n)
    n = n.strip(" -\u2013|/").strip()
    key = re.sub(r"[.]", "", n.lower())
    key = re.sub(r"\s+", " ", key).strip()
    if key in ALIAS_N:
        return ALIAS_N[key]
    # prefix/suffix alias match ("southeast missouri state university")
    for ak, av in sorted(ALIAS_N.items(), key=lambda kv: -len(kv[0])):
        if len(ak) >= 4 and (key == ak or key.startswith(ak + " ") or key.endswith(" " + ak)):
            return av
    low = n.lower()
    for official in sorted(D1_SET, key=len, reverse=True):
        ol = official.lower()
        if low == ol or low.startswith(ol + " ") or low.endswith(" " + ol):
            return official
    if not allow_unknown:
        return None
    if EVENT_NAME_RE.search(n):
        return None
    # Conferences and fragments are not teams
    if re.search(r"\b(big ten|big 12|sec|acc|mac|eagl|mpsf|ncaa|sun devils)\b", n, re.I):
        return None
    if len(n) < 3:
        return None
    return n

def is_event_title(name: str) -> bool:
    n = clean_text(name)
    if not n:
        return False
    if canonicalize_team(n, allow_unknown=False):
        return False
    return bool(EVENT_NAME_RE.search(n))

def is_exhibition(title, typ=None, date=None):
    blob = " ".join(x for x in [title, typ] if x)
    if typ and str(typ).upper() in {"E", "S", "X"} and (not date or date < SEASON_START):
        if EXHIB_RE.search(blob) or (date and date < SEASON_START):
            return True
    if EXHIB_RE.search(blob or ""):
        return True
    return False

def is_ncaa_placeholder(title):
    t = clean_text(title or "")
    return bool(NCAA_PLACEHOLDER_RE.search(t)) and not re.search(r"session|semifinal|final", t, re.I)

def is_conf_champ(title):
    t = clean_text(title or "")
    return bool(CONF_CHAMP_RE.search(t) or (
        re.search(r"championships?", t, re.I)
        and re.search(r"\b(SEC|ACC|Big Ten|Big 12|Big XII|MAC|EAGL|MPSF|GEC|MIC|MW|Mountain West|Pac-12)\b", t)
    ))

def tz_for_location(location: str, school: str | None = None):
    loc = clean_text(location or "")
    if loc:
        low = loc.lower()
        part = low.split("|")[0]
        if "," in part:
            state = part.split(",")[-1].strip(" .")
            state = re.sub(r"\s+", " ", state)
            sk = state.replace(".", "")
            if sk in STATE_TZ:
                return STATE_TZ[sk]
        city = part.split(",")[0].strip()
        if city in CITY_TZ:
            return CITY_TZ[city]
        for c, tz in CITY_TZ.items():
            if c in low:
                return tz
    if school and school in SCHOOL_TZ:
        return SCHOOL_TZ[school]
    return "America/New_York"

def parse_local_dt(date_s, time_s=None):
    date_s = clean_text(date_s or "")
    time_s = clean_text(time_s or "")
    if not date_s:
        return None
    ymd = None
    hh = mm = None
    has_time = False
    m = re.match(r"(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?", date_s)
    if m:
        ymd = m.group(1)
        if m.group(2) and not (m.group(2) == "00" and (m.group(3) or "00") == "00"):
            hh, mm = int(m.group(2)), int(m.group(3) or 0)
            has_time = True
    else:
        m = re.search(
            r"(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(20\d{2}))?",
            date_s, re.I,
        )
        if m:
            months = {
                "jan":1,"january":1,"feb":2,"february":2,"mar":3,"march":3,"apr":4,"april":4,
                "may":5,"jun":6,"june":6,"jul":7,"july":7,"aug":8,"august":8,"sep":9,"sept":9,
                "september":9,"oct":10,"october":10,"nov":11,"november":11,"dec":12,"december":12,
            }
            mo = months[m.group(1).lower().rstrip(".")]
            day = int(m.group(2))
            year = int(m.group(3) or (2026 if mo >= 8 else 2027))
            ymd = f"{year:04d}-{mo:02d}-{day:02d}"
    if not ymd:
        return None
    if time_s and not re.search(r"\b(TBA|TBD|All Day)\b", time_s, re.I) and not re.search(r"\d+\s*[-–&]\s*\d+", time_s):
        tm = re.search(r"(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?", time_s, re.I)
        if tm:
            h = int(tm.group(1)); mi = int(tm.group(2) or 0)
            ap = (tm.group(3) or "").lower().replace(".", "")
            if ap == "pm" and h < 12:
                h += 12
            if ap == "am" and h == 12:
                h = 0
            if not ap and h < 8:
                h += 12
            hh, mm = h, mi
            has_time = True
    elif re.search(r"\b(TBA|TBD)\b", time_s or "", re.I):
        has_time, hh, mm = False, None, None
    return ymd, has_time, hh, mm

def to_start_utc(ymd, has_time, hh, mm, tzname):
    if not ymd or not has_time or hh is None:
        return None, None
    try:
        tz = ZoneInfo(tzname)
    except Exception:
        tz = ZoneInfo("America/New_York")
    local = datetime(int(ymd[:4]), int(ymd[5:7]), int(ymd[8:10]), hh, mm, 0, tzinfo=tz)
    utc = local.astimezone(timezone.utc)
    et = local.astimezone(ZoneInfo("America/New_York"))
    return utc.strftime("%Y-%m-%dT%H:%M:%S.000Z"), et.strftime("%H:%M:%S")

def parse_start(date_s, time_s=None, tzname="America/New_York"):
    """Return (ymd_local, start_utc, time_et) honoring Z/offsets as UTC instants."""
    date_s = clean_text(date_s or "")
    time_s = clean_text(time_s or "")
    if not date_s:
        return None
    # Instant with timezone (Z or +/-HH:MM)
    m = re.match(
        r"(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?",
        date_s,
    )
    tz = None
    try:
        tz = ZoneInfo(tzname)
    except Exception:
        tz = ZoneInfo("America/New_York")
    if m and m.group(5):
        y, mo, d = int(m.group(1)[0:4]), int(m.group(1)[5:7]), int(m.group(1)[8:10])
        hh, mi, ss = int(m.group(2)), int(m.group(3)), int(m.group(4) or 0)
        off = m.group(5)
        if off == "Z":
            inst = datetime(y, mo, d, hh, mi, ss, tzinfo=timezone.utc)
        else:
            sign = 1 if off[0] == "+" else -1
            digits = re.sub(r"\D", "", off[1:])
            oh, om = int(digits[:2]), int(digits[2:] or 0)
            from datetime import timedelta
            inst = datetime(y, mo, d, hh, mi, ss, tzinfo=timezone.utc) - sign * timedelta(hours=oh, minutes=om)
            inst = inst.replace(tzinfo=timezone.utc)
        has_time = True  # an explicit Z/offset instant, including 00:00Z (7 PM ET)
        local = inst.astimezone(tz)
        ymd = local.strftime("%Y-%m-%d")
        if not has_time:
            return ymd, None, None
        utc = inst.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        et = inst.astimezone(ZoneInfo("America/New_York")).strftime("%H:%M:%S")
        return ymd, utc, et
    parsed = parse_local_dt(date_s, time_s)
    if not parsed:
        return None
    ymd, has_time, hh, mm = parsed
    start_utc, time_et = to_start_utc(ymd, has_time, hh, mm, tzname)
    return ymd, start_utc, time_et

def in_season(ymd, title=""):
    if not ymd:
        return False
    if ymd < SEASON_START:
        return False
    if ymd <= SEASON_END:
        return True
    if ymd <= CONF_CHAMP_END and is_conf_champ(title):
        return True
    return False

def title_season(title):
    if not title:
        return None
    span = re.search(r"\b(20\d{2})\s*[-–]\s*(\d{2})\b", title)
    if span:
        return 2000 + int(span.group(2))
    ys = [int(x) for x in re.findall(r"\b20\d{2}\b", title)]
    return max(ys) if ys else None

def page_title(html):
    m = re.search(r"<title>([^<]+)", html, re.I)
    return clean_text(htmlmod.unescape(m.group(1))) if m else ""
