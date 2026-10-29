#!/usr/bin/env python3
"""Guards supabase/config.toml, which the live project can receive through the Supabase GitHub integration.

  python3 scripts/check-config.py                      fails if config.toml holds anything that must never go live
  python3 scripts/check-config.py --apply-local CONFIG FRAGMENT
                                                       (used by scripts/local-supabase.sh) adds the local-only settings

Never allowed in config.toml: test phone numbers (a fixed code anyone could use), the local SMS hook address, the local
placeholder SMS provider, and any secret written out in plain text (secrets must be env(NAME) references).
"""
import re
import sys
import tomllib

BAD_HOSTS = ('host.docker.internal', 'localhost', '127.0.0.1')


def problems(cfg: dict) -> list[str]:
    out = []

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                yield from walk(v, path + [k])
        else:
            yield path, node

    def check_table(tag, root):
        test_otp = root.get('auth', {}).get('sms', {}).get('test_otp', {})
        if test_otp:
            out.append(f'{tag}: [auth.sms.test_otp] has {len(test_otp)} test phone number(s). Test numbers sign in with a fixed code; keep them in supabase/local/local-only.toml.')
        hook = root.get('auth', {}).get('hook', {}).get('send_sms', {})
        if any(h in str(hook.get('uri', '')) for h in BAD_HOSTS):
            out.append(f'{tag}: the Send SMS hook points at a local address ({hook.get("uri")}).')
        twilio = root.get('auth', {}).get('sms', {}).get('twilio', {})
        if twilio.get('account_sid') == 'local-placeholder':
            out.append(f'{tag}: the local placeholder SMS provider is enabled.')

    check_table('config.toml', cfg)
    for name, remote in cfg.get('remotes', {}).items():
        check_table(f'remotes.{name}', remote)

    for path, value in walk(cfg, []):
        if path and path[-1] in ('secret', 'secrets', 'auth_token', 'api_key', 'service_role_key') and isinstance(value, str) and value:
            if not re.fullmatch(r'env\([A-Z0-9_]+\)', value):
                out.append(f'config.toml: {".".join(path)} is written out in plain text. Use env(NAME).')
    return out


def apply_local(config_path: str, fragment_path: str, skip: list[str] = ()) -> None:
    text = open(config_path).read().split('\n')
    fragment = open(fragment_path).read().split('\n')
    # Split the fragment into tables.
    tables, current = {}, None
    for line in fragment:
        m = re.match(r'^\[([^\]]+)\]\s*$', line)
        if m:
            current = m.group(1)
            tables[current] = []
        elif current and line.strip() and not line.lstrip().startswith('#'):
            tables[current].append(line)
    for name, body in tables.items():
        if name in skip:
            continue
        header = f'[{name}]'
        if header in text:
            i = text.index(header)
            j = i + 1
            while j < len(text) and not re.match(r'^\[', text[j]):
                j += 1
            section = text[i + 1:j]
            for line in body:                                 # replace a key that is there, otherwise add it
                key = line.split('=')[0].strip()
                for n, existing in enumerate(section):
                    if existing.split('=')[0].strip() == key and not existing.lstrip().startswith('#'):
                        section[n] = line
                        break
                else:
                    section.insert(0, line)
            text[i + 1:j] = section
        else:
            text += ['', header] + body
    open(config_path, 'w').write('\n'.join(text))


if __name__ == '__main__':
    if len(sys.argv) >= 4 and sys.argv[1] == '--apply-local':
        apply_local(sys.argv[2], sys.argv[3], skip=sys.argv[4:])
        sys.exit(0)
    with open('supabase/config.toml', 'rb') as f:
        found = problems(tomllib.load(f))
    if found:
        print('config check FAILED: supabase/config.toml could put something unsafe on the live project:')
        for p in found:
            print('  - ' + p)
        sys.exit(1)
    print('config check OK')
