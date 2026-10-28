"""Fails CI if an unexpected SQL error appears in the security test log.
Each test block starts with an \\echo line; blocks whose title contains 'expect ERROR' must contain an error."""
import re, sys
log = open(sys.argv[1], encoding='utf-8').read()
blocks = re.split(r'\n(?=--- [A-Za-z]|=== )', log)
bad = []
for b in blocks:
    title = b.strip().splitlines()[0] if b.strip() else ''
    has_err = bool(re.search(r'^psql:.*ERROR', b, re.M))
    if 'expect ERROR' in title and not has_err:
        bad.append('MISSING expected error: ' + title)
    if 'expect ERROR' not in title and has_err:
        bad.append('UNEXPECTED error in: ' + title)
titles = re.findall(r'^--- T(\d+)', log, re.M)
if len(titles) < 24:
    bad.append(f'Only {len(titles)} of 24+ security tests ran: the database or a migration failed. Check the log.')
if re.search(r'Connection refused|could not connect|^psql: error', log, re.M):
    bad.append('Could not connect to the database.')
print('\n'.join(bad) or f'security tests OK ({len(titles)} tests)')
sys.exit(1 if bad else 0)
