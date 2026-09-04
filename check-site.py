"""Fails if the site disagrees with the latest published Alcove release.

    python check-site.py

The version and the installer's checksum are written into the pages by hand, in
more places than is comfortable to remember: a release day that updates
alcove/index.html and forgets index.html leaves a download button serving the
previous build. That has happened. This is the check that catches it.

Needs `gh` on PATH and network. Exits non-zero on any mismatch.
"""
import glob
import hashlib
import json
import re
import subprocess
import sys
import urllib.request


def gh(*args):
    return json.loads(subprocess.run(["gh", *args], capture_output=True, text=True,
                                     check=True).stdout)


rel = gh("release", "view", "--repo", "izkac/alcove", "--json", "tagName,assets")
version = rel["tagName"].lstrip("v")
exe = next(a for a in rel["assets"] if a["name"].endswith("-setup.exe"))
url = f"https://github.com/izkac/alcove/releases/download/{rel['tagName']}/{exe['name']}"

print(f"latest release: {rel['tagName']}  ({exe['name']}, {exe['size']} bytes)")
digest = hashlib.sha256(urllib.request.urlopen(url).read()).hexdigest()
print(f"sha256: {digest}")

problems = []
# The policy page deliberately names old versions ("anything 0.2.3 or older"),
# so only the two pages that offer a download are checked for staleness.
for path in ["index.html", "alcove/index.html"]:
    html = open(path, encoding="utf-8").read()

    stale = {v for v in re.findall(r"\b0\.\d+\.\d+\b", html) if v != version}
    if stale:
        problems.append(f"{path}: names old version(s) {', '.join(sorted(stale))}")

    for bad in set(re.findall(r"releases/download/(v[\d.]+)/", html)) - {rel["tagName"]}:
        problems.append(f"{path}: download link points at {bad}")

    if "sha256" in html.lower() or re.search(r"\b[0-9a-f]{64}\b", html):
        for found in set(re.findall(r"\b[0-9a-f]{64}\b", html)) - {digest}:
            problems.append(f"{path}: publishes a checksum that is not the release's ({found[:16]}…)")

# Whatever the site links to must actually be what the site says it is.
for path in glob.glob("*.html") + glob.glob("*/index.html"):
    html = open(path, encoding="utf-8").read()
    if digest in html and url not in html:
        problems.append(f"{path}: publishes the checksum but links elsewhere")

if problems:
    print("\nFAIL")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("\nOK: pages agree with the published release")
