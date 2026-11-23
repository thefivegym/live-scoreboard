#!/usr/bin/env python3
"""Shared helpers for scraping announced 2026-27 D1 women's gymnastics schedules."""
from __future__ import annotations

import json, os, re, time, html as htmlmod
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

WORKDIR = os.path.dirname(os.path.abspath(__file__))
# Repo root: SCOREBOARD_REPO, or two levels up from scripts/announced-schedule/, or a local work dir.
REPO = os.environ.get("SCOREBOARD_REPO") or (
    os.path.abspath(os.path.join(WORKDIR, "..", ".."))
    if os.path.basename(os.path.dirname(WORKDIR)) == "scripts"
    else "/workspace/live-gym-scoreboard"
)
RAW = os.environ.get("ANNOUNCED_RAW") or os.path.join(WORKDIR, "raw")
# Prefer writing the published announced file into the repo data dir.
OUT = os.environ.get("ANNOUNCED_OUT") or (
    os.path.join(REPO, "data", "announced") if os.path.isdir(os.path.join(REPO, "data")) else os.path.join(WORKDIR, "out")
)
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 TheFiveThatScore-Scoreboard/1.0 (+https://x.com/thefivethatscore)"
TIMEOUT = 25
SEASON = 2027
SEASON_START = "2027-01-01"
SEASON_END = "2027-03-31"
CONF_CHAMP_END = "2027-04-06"
PARALLEL = 8
MIN_GAP = 0.8
DEFAULT_DELAY = 2.0

SITES = {
  "Air Force": {"site": "goairforcefalcons.com"},
  "Alabama": {"site": "rolltide.com"},
  "Alaska": {"site": "goseawolves.com"},
  "Arizona": {"site": "arizonawildcats.com"},
  "Arizona State": {"site": "thesundevils.com"},
  "Arkansas": {"site": "arkansasrazorbacks.com", "paths": ["/sport/w-gym/schedule/"]},
  "Auburn": {"site": "auburntigers.com"},
  "Ball State": {"site": "ballstatesports.com"},
  "Boise State": {"site": "broncosports.com"},
  "Bowling Green": {"site": "bgsufalcons.com"},
  "Brown": {"site": "brownbears.com"},
  "BYU": {"site": "byucougars.com"},
  "California": {"site": "calbears.com"},
  "Central Michigan": {"site": "cmuchippewas.com"},
  "Clemson": {"site": "clemsontigers.com", "paths": ["/sports/gymnastics/schedule/"]},
  "Cornell": {"site": "cornellbigred.com"},
  "Denver": {"site": "denverpioneers.com"},
  "Eastern Michigan": {"site": "emueagles.com"},
  "Florida": {"site": "floridagators.com", "paths": ["/sports/gymnastics/schedule"]},
  "George Washington": {"site": "gwsports.com"},
  "Georgia": {"site": "georgiadogs.com"},
  "Illinois": {"site": "fightingillini.com"},
  "Illinois State": {"site": "goredbirds.com"},
  "Iowa": {"site": "hawkeyesports.com", "paths": ["/sports/wgym/schedule/"]},
  "Iowa State": {"site": "cyclones.com"},
  "Kent State": {"site": "kentstatesports.com"},
  "Kentucky": {"site": "ukathletics.com", "paths": ["/sports/wgym/schedule/", "/sports/gymnastics/schedule/"]},
  "LIU": {"site": "liuathletics.com"},
  "LSU": {"site": "lsusports.net", "paths": ["/sports/womens-gymnastics/schedule/", "/sports/gym/schedule/", "/sports/gymnastics/schedule/"]},
  "Maryland": {"site": "umterps.com"},
  "Michigan": {"site": "mgoblue.com"},
  "Michigan State": {"site": "msuspartans.com"},
  "Minnesota": {"site": "gophersports.com"},
  "Missouri": {"site": "mutigers.com"},
  "Nebraska": {"site": "huskers.com"},
  "New Hampshire": {"site": "unhwildcats.com"},
  "North Carolina": {"site": "goheels.com"},
  "North Carolina State": {"site": "gopack.com"},
  "Northern Illinois": {"site": "niuhuskies.com"},
  "Ohio State": {"site": "ohiostatebuckeyes.com", "paths": ["/sports/womens-gymnastics/schedule/"]},
  "Oklahoma": {"site": "soonersports.com"},
  "Oregon State": {"site": "osubeavers.com"},
  "Penn State": {"site": "gopsusports.com"},
  "Pennsylvania": {"site": "pennathletics.com"},
  "Pittsburgh": {"site": "pittsburghpanthers.com"},
  "Rutgers": {"site": "scarletknights.com"},
  "S.E. Missouri": {"site": "semoredhawks.com"},
  "Sacramento State": {"site": "hornetsports.com"},
  "San Jose State": {"site": "sjsuspartans.com"},
  "Southern Utah": {"site": "suutbirds.com"},
  "Stanford": {"site": "gostanford.com"},
  "Temple": {"site": "owlsports.com"},
  "Towson": {"site": "towsontigers.com"},
  "UC Davis": {"site": "ucdavisaggies.com"},
  "UCLA": {"site": "uclabruins.com"},
  "Utah": {"site": "utahutes.com"},
  "Utah State": {"site": "utahstateaggies.com"},
  "Washington": {"site": "gohuskies.com"},
  "West Virginia": {"site": "wvusports.com"},
  "Western Michigan": {"site": "wmubroncos.com"},
  "William & Mary": {"site": "tribeathletics.com"},
  "Yale": {"site": "yalebulldogs.com"},
}
DEFAULT_PATHS = [
    "/sports/womens-gymnastics/schedule/2026-27",
    "/sports/womens-gymnastics/schedule",
    "/sports/gymnastics/schedule/2026-27",
    "/sports/gymnastics/schedule",
    "/sports/wgym/schedule/2026-27",
    "/sports/wgym/schedule",
    "/sports/w-gym/schedule/2026-27",
    "/sports/w-gym/schedule",
    "/sport/w-gym/schedule/",
]

with open(os.path.join(REPO, "data/d1-teams.json"), encoding="utf-8") as f:
    D1_TEAMS = [t["name"] for t in json.load(f)["teams"]]
D1_SET = set(D1_TEAMS)

SCHOOL_TZ = {
    "Air Force": "America/Denver", "Alabama": "America/Chicago", "Alaska": "America/Anchorage",
    "Arizona": "America/Phoenix", "Arizona State": "America/Phoenix", "Arkansas": "America/Chicago",
    "Auburn": "America/Chicago", "Ball State": "America/Indiana/Indianapolis", "Boise State": "America/Boise",
    "Bowling Green": "America/New_York", "Brown": "America/New_York", "BYU": "America/Denver",
    "California": "America/Los_Angeles", "Central Michigan": "America/New_York", "Clemson": "America/New_York",
    "Cornell": "America/New_York", "Denver": "America/Denver", "Eastern Michigan": "America/New_York",
    "Florida": "America/New_York", "George Washington": "America/New_York", "Georgia": "America/New_York",
    "Illinois": "America/Chicago", "Illinois State": "America/Chicago", "Iowa": "America/Chicago",
    "Iowa State": "America/Chicago", "Kent State": "America/New_York", "Kentucky": "America/New_York",
    "LIU": "America/New_York", "LSU": "America/Chicago", "Maryland": "America/New_York",
    "Michigan": "America/New_York", "Michigan State": "America/New_York", "Minnesota": "America/Chicago",
    "Missouri": "America/Chicago", "Nebraska": "America/Chicago", "New Hampshire": "America/New_York",
    "North Carolina": "America/New_York", "North Carolina State": "America/New_York",
    "Northern Illinois": "America/Chicago", "Ohio State": "America/New_York", "Oklahoma": "America/Chicago",
    "Oregon State": "America/Los_Angeles", "Penn State": "America/New_York", "Pennsylvania": "America/New_York",
    "Pittsburgh": "America/New_York", "Rutgers": "America/New_York", "S.E. Missouri": "America/Chicago",
    "Sacramento State": "America/Los_Angeles", "San Jose State": "America/Los_Angeles",
    "Southern Utah": "America/Denver", "Stanford": "America/Los_Angeles", "Temple": "America/New_York",
    "Towson": "America/New_York", "UC Davis": "America/Los_Angeles", "UCLA": "America/Los_Angeles",
    "Utah": "America/Denver", "Utah State": "America/Denver", "Washington": "America/Los_Angeles",
    "West Virginia": "America/New_York", "Western Michigan": "America/New_York",
    "William & Mary": "America/New_York", "Yale": "America/New_York",
}

ALIASES = {
    "lsu": "LSU", "louisiana state": "LSU", "louisiana state university": "LSU",
    "louisiana state tigers": "LSU",
    "semo": "S.E. Missouri", "s.e. missouri": "S.E. Missouri", "se missouri": "S.E. Missouri",
    "southeast missouri": "S.E. Missouri", "southeast missouri state": "S.E. Missouri",
    "se missouri state": "S.E. Missouri", "southeast mo": "S.E. Missouri",
    "penn": "Pennsylvania", "upenn": "Pennsylvania", "u penn": "Pennsylvania",
    "pennsylvania": "Pennsylvania",
    "uc davis": "UC Davis", "u.c. davis": "UC Davis", "ucdavis": "UC Davis",
    "ucla": "UCLA",
    "cal": "California", "california": "California", "cal berkeley": "California",
    "uc berkeley": "California", "berkeley": "California", "california golden bears": "California",
    "nc state": "North Carolina State", "n.c. state": "North Carolina State",
    "north carolina state": "North Carolina State", "ncsu": "North Carolina State",
    "unc": "North Carolina", "north carolina": "North Carolina",
    "central michigan": "Central Michigan", "cmu": "Central Michigan", "central mich": "Central Michigan",
    "george washington": "George Washington", "gw": "George Washington", "gwu": "George Washington",
    "bowling green": "Bowling Green", "bgsu": "Bowling Green", "bowling green state": "Bowling Green",
    "william & mary": "William & Mary", "william and mary": "William & Mary", "w&m": "William & Mary",
    "sacramento state": "Sacramento State", "sac state": "Sacramento State", "sacramento st": "Sacramento State",
    "san jose state": "San Jose State", "san josé state": "San Jose State", "sjsu": "San Jose State",
    "san jose st": "San Jose State",
    "southern utah": "Southern Utah", "suu": "Southern Utah",
    "utah state": "Utah State", "usu": "Utah State", "utah st": "Utah State",
    "air force": "Air Force", "u.s. air force": "Air Force", "air force academy": "Air Force",
    "penn state": "Penn State", "penn st": "Penn State", "psu": "Penn State",
    "byu": "BYU", "brigham young": "BYU", "brigham young university": "BYU",
    "liu": "LIU", "long island": "LIU", "liu brooklyn": "LIU", "long island university": "LIU",
    "alaska": "Alaska", "alaska anchorage": "Alaska", "alaska-anchorage": "Alaska", "uaa": "Alaska", "anchorage": "Alaska",
    "university of alaska anchorage": "Alaska",
    "illinois state": "Illinois State", "illinois st": "Illinois State", "ilstu": "Illinois State",
    "iowa state": "Iowa State", "iowa st": "Iowa State",
    "michigan state": "Michigan State", "michigan st": "Michigan State",
    "ohio state": "Ohio State", "ohio st": "Ohio State",
    "oregon state": "Oregon State", "oregon st": "Oregon State",
    "arizona state": "Arizona State", "arizona st": "Arizona State",
    "western michigan": "Western Michigan", "western mich": "Western Michigan", "wmu": "Western Michigan",
    "northern illinois": "Northern Illinois", "niu": "Northern Illinois", "northern ill": "Northern Illinois",
    "eastern michigan": "Eastern Michigan", "emu": "Eastern Michigan",
    "ball state": "Ball State", "ball st": "Ball State",
    "kent state": "Kent State", "kent st": "Kent State",
    "new hampshire": "New Hampshire", "unh": "New Hampshire",
    "pitt": "Pittsburgh", "pittsburgh": "Pittsburgh",
    "towson": "Towson", "temple": "Temple", "yale": "Yale", "brown": "Brown",
    "cornell": "Cornell", "maryland": "Maryland", "umd": "Maryland",
    "florida": "Florida", "florida gators": "Florida",
    "alabama": "Alabama", "alabama crimson tide": "Alabama",
    "arkansas": "Arkansas", "auburn": "Auburn", "georgia": "Georgia", "uga": "Georgia",
    "kentucky": "Kentucky", "missouri": "Missouri", "mizzou": "Missouri",
    "oklahoma": "Oklahoma", "utah": "Utah", "washington": "Washington",
    "michigan": "Michigan", "minnesota": "Minnesota", "illinois": "Illinois",
    "iowa": "Iowa", "nebraska": "Nebraska", "denver": "Denver", "stanford": "Stanford",
    "clemson": "Clemson", "boise state": "Boise State", "boise st": "Boise State",
    "rutgers": "Rutgers", "west virginia": "West Virginia", "wvu": "West Virginia",
    "arizona": "Arizona",
    "twu": "Texas Woman's", "texas woman's": "Texas Woman's", "texas womans": "Texas Woman's",
    "texas woman's university": "Texas Woman's", "texas womans university": "Texas Woman's",
    "fisk": "Fisk", "fisk university": "Fisk",
    "bridgeport": "Bridgeport", "brockport": "Brockport", "suny brockport": "Brockport",
    "west chester": "West Chester", "west chester university": "West Chester",
    "southern conn": "Southern Conn.", "southern connecticut": "Southern Conn.",
    "southern connecticut state": "Southern Conn.", "southern conn.": "Southern Conn.",
    "springfield": "Springfield College", "springfield college": "Springfield College",
    "rhode island college": "Rhode Island College",
    "centenary": "Centenary College", "centenary college": "Centenary College",
    "wilberforce": "Wilberforce", "ithaca": "Ithaca College", "ithaca college": "Ithaca College",
    "ursinus": "Ursinus College", "ursinus college": "Ursinus College",
    "utica": "Utica", "winona state": "Winona State", "simpson": "Simpson",
    "cortland": "Cortland State", "cortland state": "Cortland State",
    "uw-la crosse": "UW-La Crosse", "uw la crosse": "UW-La Crosse", "wisconsin-la crosse": "UW-La Crosse", "wis-la crosse": "UW-La Crosse", "wis la crosse": "UW-La Crosse",
    "uw-stout": "UW-Stout", "uw stout": "UW-Stout", "wisconsin-stout": "UW-Stout", "wisconsin stout": "UW-Stout", "wisconsin-stout poly": "UW-Stout",
    "uw-eau claire": "UW-Eau Claire", "uw-oshkosh": "UW-Oshkosh", "wisconsin-oshkosh": "UW-Oshkosh", "university of wisconsin-oshkosh": "UW-Oshkosh", "wisconsin oshkosh": "UW-Oshkosh", "uw-whitewater": "UW-Whitewater",
}

ALIAS_N = {}
for k, v in ALIASES.items():
    ALIAS_N[re.sub(r"[.]", "", k).strip()] = v
    ALIAS_N[k] = v
for name in D1_TEAMS:
    nk = re.sub(r"\s+", " ", name.lower()).strip()
    ALIAS_N[nk] = name
    ALIAS_N[re.sub(r"[.]", "", nk)] = name

