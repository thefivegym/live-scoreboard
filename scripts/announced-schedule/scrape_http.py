
"""Polite HTTP fetch with robots.txt handling."""
from __future__ import annotations
import re, time
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from scrape_lib import UA, TIMEOUT, MIN_GAP, DEFAULT_DELAY

_host_next = {}
_host_delay = {}
_robots = {}
_last_any = 0

def _decode_body(body, headers=None):
    import gzip, zlib
    enc = ""
    if headers is not None:
        enc = (headers.get("Content-Encoding") or "").lower()
    if enc == "gzip" or body[:2] == b"\x1f\x8b":
        try:
            return gzip.decompress(body)
        except Exception:
            return body
    if enc in ("deflate", "zlib"):
        try:
            return zlib.decompress(body)
        except Exception:
            return body
    return body

def _fetch(url, accept="text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"):
    req = Request(url, headers={
        "User-Agent": UA, "Accept": accept, "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
    })
    with urlopen(req, timeout=TIMEOUT) as res:
        body = _decode_body(res.read(), res.headers)
        return res.getcode(), res.geturl(), res.headers.get_content_type(), body

def polite_fetch(url, accept=None):
    global _last_any
    host = urlparse(url).hostname
    delay = max(DEFAULT_DELAY, _host_delay.get(host, 0))
    now = time.time()
    slot = max(now, _host_next.get(host, 0))
    wait = slot - now
    if wait > 0:
        time.sleep(wait)
    g = MIN_GAP - (time.time() - _last_any)
    if g > 0:
        time.sleep(g)
    _last_any = time.time()
    _host_next[host] = time.time() + delay
    try:
        code, final, ctype, body = _fetch(url, accept or "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8")
        return {"ok": 200 <= code < 300, "status": code, "url": final, "ctype": ctype, "body": body, "error": None}
    except HTTPError as e:
        body = e.read() if e.fp else b""
        return {"ok": False, "status": e.code, "url": url, "ctype": "", "body": body, "error": str(e)}
    except Exception as e:
        return {"ok": False, "status": 0, "url": url, "ctype": "", "body": b"", "error": str(e)}

def load_robots(origin):
    if origin in _robots:
        return _robots[origin]
    rules = {"allow": [], "disallow": [], "delay": 0}
    try:
        r = polite_fetch(origin + "/robots.txt", accept="text/plain,*/*")
        text = r["body"].decode("utf-8", "replace") if r["ok"] and not r["body"].lstrip().startswith(b"<") else ""
        in_group = False
        saw_rule = False
        for raw in text.splitlines():
            line = re.sub(r"#.*", "", raw).strip()
            m = re.match(r"^([A-Za-z-]+)\s*:\s*(.*)$", line)
            if not m:
                continue
            k, v = m.group(1).lower(), m.group(2).strip()
            if k == "user-agent":
                if saw_rule:
                    in_group = False
                    saw_rule = False
                if v == "*" or "thefivethatscore" in v.lower():
                    in_group = True
                continue
            saw_rule = True
            if not in_group:
                continue
            if k == "disallow" and v:
                rules["disallow"].append(v)
            elif k == "allow" and v:
                rules["allow"].append(v)
            elif k == "crawl-delay":
                try:
                    rules["delay"] = float(v or 0)
                except ValueError:
                    pass
        if rules["delay"]:
            host = urlparse(origin).hostname
            _host_delay[host] = min(rules["delay"], 30)
    except Exception:
        pass
    _robots[origin] = rules
    return rules

def robots_allows(rules, path):
    def match(p, path):
        re_pat = "^" + re.escape(p).replace(r"\*", ".*")
        return re.search(re_pat, path) is not None
    a = max([len(p) for p in rules["allow"] if match(p, path)] or [-1])
    d = max([len(p) for p in rules["disallow"] if match(p, path)] or [-1])
    return d < 0 or a >= d
