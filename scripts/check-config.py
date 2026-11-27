#!/usr/bin/env python3
"""Guards supabase/config.toml, which the live project can receive through the Supabase GitHub integration.

  python3 scripts/check-config.py                      fails if config.toml holds anything that must never go live

Never allowed in config.toml: test phone numbers (a fixed code anyone could use), phone sign-in, a hook that points at a
local address, and any secret written out in plain text (secrets must be env(NAME) references). Admin settings
(password rules, email confirmation) must not be loosened. The admin second step is a passkey, enforced by the database
(migration 0014) and the `admin-passkey` edge function, so the authenticator-app (TOTP) settings are no longer checked; that
function must keep verify_jwt = true.
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
            out.append(f'{tag}: [auth.sms.test_otp] has {len(test_otp)} test phone number(s). Test numbers sign in with a fixed code; do not add them.')
        for name, hook in root.get('auth', {}).get('hook', {}).items():
            if any(h in str(hook.get('uri', '')) for h in BAD_HOSTS):
                out.append(f'{tag}: the {name} hook points at a local address ({hook.get("uri")}).')
        if root.get('auth', {}).get('sms', {}).get('enable_signup'):
            out.append(f'{tag}: [auth.sms] enable_signup must be false (PawsPal signs up by email only).')

    def check_admin_settings(tag, root):
        # Admins sign in with email and password, so these must not be loosened.
        auth = root.get('auth', {})
        if auth.get('minimum_password_length', 0) < 12:
            out.append(f'{tag}: [auth] minimum_password_length must be at least 12 (admins use passwords).')
        if not auth.get('password_requirements'):
            out.append(f'{tag}: [auth] password_requirements must be set (letters and digits).')
        if not auth.get('email', {}).get('enable_confirmations', False):
            out.append(f'{tag}: [auth.email] enable_confirmations must stay true (it stops someone registering an invited admin email).')
        # The passkey step is enforced by public.is_admin() and the admin-passkey function, which needs a verified user token.
        fn = root.get('functions', {}).get('admin-passkey')
        if fn is not None and fn.get('verify_jwt') is not True:
            out.append(f'{tag}: [functions.admin-passkey] verify_jwt must be true (the passkey step needs the signed-in admin\'s token).')

    check_table('config.toml', cfg)
    check_admin_settings('config.toml', cfg)
    for name, remote in cfg.get('remotes', {}).items():
        check_table(f'remotes.{name}', remote)

    for path, value in walk(cfg, []):
        if path and path[-1] in ('secret', 'secrets', 'auth_token', 'api_key', 'service_role_key', 'pass') and isinstance(value, str) and value:
            if not re.fullmatch(r'env\([A-Z0-9_]+\)', value):
                out.append(f'config.toml: {".".join(path)} is written out in plain text. Use env(NAME).')
    return out


if __name__ == '__main__':
    with open('supabase/config.toml', 'rb') as f:
        found = problems(tomllib.load(f))
    if found:
        print('config check FAILED: supabase/config.toml could put something unsafe on the live project:')
        for p in found:
            print('  - ' + p)
        sys.exit(1)
    print('config check OK')
