"""Gate for database migrations. Usage: python3 scripts/check-migrations.py <base-ref>

Looks at the migrations that changed between <base-ref> and HEAD (use "ROOT" to check every migration) and fails if:
  1. an already-pushed migration was edited, renamed or deleted (add a new numbered one instead), unless
     supabase/approved-migration-edits.txt lists that file with the SHA-256 of its exact new contents
     (a one-time approval for a migration that was never deployed; any further edit changes the hash and fails again), or
  2. a new migration contains DROP TABLE, DROP COLUMN, DROP SCHEMA, TRUNCATE or DELETE without WHERE,
     unless that file contains the comment  -- destructive-approved
     (that comment may only be added when the founder explicitly says so in chat; see CLAUDE.md).
"""
import hashlib
import re
import subprocess
import sys

MARKER = '-- destructive-approved'

DESTRUCTIVE = [
    ('DROP TABLE', re.compile(r'\bdrop\s+table\b', re.I)),
    ('DROP COLUMN', re.compile(r'\bdrop\s+column\b', re.I)),
    ('DROP SCHEMA', re.compile(r'\bdrop\s+schema\b', re.I)),
    ('TRUNCATE', re.compile(r'\btruncate\b', re.I)),
]
DELETE_FROM = re.compile(r'\bdelete\s+from\b', re.I)
WHERE = re.compile(r'\bwhere\b', re.I)


def git(*args):
    return subprocess.run(['git', *args], check=True, capture_output=True, text=True).stdout


def strip_noise(sql):
    """Remove comments and string literals so words inside them do not trigger the check."""
    sql = re.sub(r'/\*.*?\*/', ' ', sql, flags=re.S)
    sql = re.sub(r'--[^\n]*', ' ', sql)
    return re.sub(r"'(?:[^']|'')*'", "''", sql)


def findings(sql):
    code = strip_noise(sql)
    found = [name for name, rx in DESTRUCTIVE if rx.search(code)]
    # A statement ends at ';'. Function bodies contain ';' too, which only makes the check stricter.
    for stmt in code.split(';'):
        if DELETE_FROM.search(stmt) and not WHERE.search(stmt):
            found.append('DELETE without WHERE')
    return sorted(set(found))


def approved_edit(path):
    """True if the file's exact current contents are listed in the approvals file (read from HEAD)."""
    try:
        listing = git('show', 'HEAD:supabase/approved-migration-edits.txt')
    except subprocess.CalledProcessError:
        return False
    digest = hashlib.sha256(git('show', f'HEAD:{path}').encode()).hexdigest()
    name = path.rsplit('/', 1)[-1]
    for line in listing.splitlines():
        parts = line.split('#')[0].split()
        if len(parts) == 2 and parts[0] == name and parts[1] == digest:
            return True
    return False


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else 'ROOT'
    if base != 'ROOT' and set(base) != {'0'}:
        try:
            git('rev-parse', '--verify', '--quiet', base + '^{commit}')
        except subprocess.CalledProcessError:
            print(f'Base {base} not found in this checkout; checking every migration.')
            base = 'ROOT'

    if base == 'ROOT' or set(base) == {'0'}:
        files = git('ls-tree', '-r', '--name-only', 'HEAD', '--', 'supabase/migrations').splitlines()
        changes = ['A\t' + f for f in files]
    else:
        changes = git('diff', '--name-status', '--no-renames', base, 'HEAD', '--', 'supabase/migrations').splitlines()
    problems, checked = [], []
    for line in changes:
        status, path = line.split('\t', 1)
        if not path.endswith('.sql'):
            continue
        if status != 'A':
            if status == 'M' and approved_edit(path):
                print(f'{path}: edit of an existing migration allowed by supabase/approved-migration-edits.txt')
                checked.append(path)
                continue
            problems.append(f'{path}: an existing migration was changed or deleted. Add a new numbered migration instead.')
            continue
        sql = git('show', f'HEAD:{path}')
        checked.append(path)
        bad = findings(sql)
        if bad and MARKER not in sql:
            problems.append(f'{path}: contains {", ".join(bad)}. Needs the comment "{MARKER}" '
                            'which may only be added when the founder approves it in chat.')

    print(f'Checked {len(checked)} new migration(s): ' + (', '.join(checked) or 'none'))
    if problems:
        print('\nMIGRATION CHECK FAILED')
        print('\n'.join(problems))
        sys.exit(1)
    print('migration check OK')


if __name__ == '__main__':
    main()
