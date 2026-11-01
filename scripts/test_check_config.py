#!/usr/bin/env python3
"""Self-test for scripts/check-config.py: the check must catch each unsafe setting and pass a clean file."""
import importlib.util
import tomllib
import unittest

spec = importlib.util.spec_from_file_location('check_config', 'scripts/check-config.py')
cc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cc)


SAFE_ADMIN = '[auth]\nminimum_password_length = 12\npassword_requirements = "lower_upper_letters_digits"\n[auth.email]\nenable_confirmations = true\n[auth.mfa.totp]\nenroll_enabled = true\nverify_enabled = true\n'


def p(text, admin=SAFE_ADMIN):
    return cc.problems(tomllib.loads(text + '\n' + admin))


class CheckConfig(unittest.TestCase):
    def test_admin_settings(self):
        self.assertEqual(p(''), [])
        self.assertTrue(p('', admin=SAFE_ADMIN.replace('= 12', '= 8')))
        self.assertTrue(p('', admin=SAFE_ADMIN.replace('password_requirements = "lower_upper_letters_digits"\n', '')))
        self.assertTrue(p('', admin=SAFE_ADMIN.replace('enable_confirmations = true', 'enable_confirmations = false')))
        self.assertTrue(p('', admin=SAFE_ADMIN.replace('verify_enabled = true', 'verify_enabled = false')))
        self.assertTrue(p('', admin=''))


    def test_clean(self):
        self.assertEqual(p('[auth.sms]\nenable_signup = false\n[auth.sms.test_otp]\n'), [])

    def test_test_numbers(self):
        self.assertTrue(p('[auth.sms.test_otp]\n201000000001 = "123456"\n'))

    def test_remote_test_numbers(self):
        self.assertTrue(p('[remotes.production.auth.sms.test_otp]\n201000000001 = "123456"\n'))

    def test_phone_signup_is_off(self):
        self.assertTrue(p('[auth.sms]\nenable_signup = true\n'))

    def test_local_hook(self):
        self.assertTrue(p('[auth.hook.send_sms]\nuri = "http://host.docker.internal:54321/functions/v1/send-sms"\n'))
        self.assertTrue(p('[auth.hook.before_user_created]\nuri = "http://127.0.0.1:54321/x"\n'))
        self.assertEqual(p('[auth.hook.send_sms]\nuri = "https://abc.supabase.co/functions/v1/x"\n'), [])

    def test_plain_text_secret(self):
        self.assertTrue(p('[auth.email.smtp]\npass = "re_123"\napi_key = "abc"\n'))
        self.assertTrue(p('[auth.external.apple]\nsecret = "abc"\n'))
        self.assertEqual(p('[auth.external.apple]\nsecret = "env(APPLE_SECRET)"\n'), [])

    def test_repo_config_is_clean(self):
        with open('supabase/config.toml', 'rb') as f:
            self.assertEqual(cc.problems(tomllib.load(f)), [])


if __name__ == '__main__':
    unittest.main()
