"""Fails if the server's current legal versions differ from the version line in docs/legal/*.md.
Usage: python3 scripts/check-legal-versions.py <psql command that connects to the migrated database>
Example: python3 scripts/check-legal-versions.py "psql -d pawspal_test"
The app shows the documents from docs/legal; users accept the version the server calls current. If they drift apart,
a user could accept a version they were never shown (or never be able to accept at all).
"""
import re
import shlex
import subprocess
import sys

FILES = {'privacy': 'privacy-policy.md', 'terms': 'terms-of-service.md', 'guidelines': 'community-guidelines.md'}


def doc_version(name):
    text = open(f'docs/legal/{name}', encoding='utf-8').read()
    m = re.match(r'---\n(.*?)\n---\n', text, re.S)
    v = re.search(r'^version:\s*(\S+)\s*$', m.group(1) if m else '', re.M)
    if not v:
        sys.exit(f'docs/legal/{name} has no "version:" line')
    return v.group(1)


def main():
    psql = shlex.split(sys.argv[1])
    out = subprocess.run(psql + ['-At', '-F', '|', '-c', 'select doc, current_version from public.legal_documents'],
                         check=True, capture_output=True, text=True).stdout
    server = dict(line.split('|', 1) for line in out.splitlines() if line)
    problems = []
    for doc, fname in FILES.items():
        want = doc_version(fname)
        have = server.get(doc)
        if have != want:
            problems.append(f'{doc}: docs/legal/{fname} says {want}, the database says {have}. '
                            'Change a version in both places (a new migration updates public.legal_documents).')
    if problems:
        print('LEGAL VERSION CHECK FAILED\n' + '\n'.join(problems))
        sys.exit(1)
    print('legal versions OK: ' + ', '.join(f'{d} {server[d]}' for d in FILES))


main()
