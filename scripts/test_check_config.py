#!/usr/bin/env python3
"""Self-test for scripts/check-config.py: the check must catch each unsafe setting and pass a clean file."""
import importlib.util
import tomllib
import unittest

spec = importlib.util.spec_from_file_location('check_config', 'scripts/check-config.py')
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


def p(text):
    return cc.problems(tomllib.loads(text))


class CheckConfig(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(p('[auth.sms.test_otp]\n[auth.sms.twilio]\nenabled = false\nauth_token = "env(X_TOKEN)"\n'), [])

    def test_test_numbers(self):
        self.assertTrue(p('[auth.sms.test_otp]\n201000000001 = "123456"\n'))

    def test_remote_test_numbers(self):
        self.assertTrue(p('[remotes.production.auth.sms.test_otp]\n201000000001 = "123456"\n'))

    def test_local_hook(self):
        self.assertTrue(p('[auth.hook.send_sms]\nuri = "http://host.docker.internal:54321/functions/v1/send-sms"\n'))
        self.assertTrue(p('[auth.hook.send_sms]\nuri = "http://127.0.0.1:54321/x"\n'))
        self.assertEqual(p('[auth.hook.send_sms]\nuri = "https://abc.supabase.co/functions/v1/send-sms"\n'), [])

    def test_placeholder_provider(self):
        self.assertTrue(p('[auth.sms.twilio]\nenabled = true\naccount_sid = "local-placeholder"\n'))

    def test_plain_text_secret(self):
        self.assertTrue(p('[auth.captcha]\nsecret = "0x4AAAAAAA"\n'))
        self.assertEqual(p('[auth.captcha]\nsecret = "env(TURNSTILE_SECRET)"\n'), [])

    def test_local_merge_is_caught(self):
        import os, shutil, tempfile
        d = tempfile.mkdtemp()
        shutil.copy('supabase/config.toml', d + '/c.toml')
        cc.apply_local(d + '/c.toml', 'supabase/local/local-only.toml')
        with open(d + '/c.toml', 'rb') as f:
            self.assertTrue(cc.problems(tomllib.load(f)), 'the local settings must trip the check if they ever reach config.toml')


if __name__ == '__main__':
    unittest.main()
