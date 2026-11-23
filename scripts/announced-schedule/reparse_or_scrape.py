#!/usr/bin/env python3
"""Weekly/manual entry point: scrape school sites (or --reparse-only saved HTML) and write
data/announced/2027.json. scripts/build-schedule.mjs then folds this into the live calendar.
"""
import os, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
os.environ.setdefault("SCOREBOARD_REPO", str(ROOT.parents[1]))
sys.path.insert(0, str(ROOT))
args = sys.argv[1:]
if "--reparse-only" in args:
    from reparse_all import main
else:
    from scrape_2027 import main
main()
