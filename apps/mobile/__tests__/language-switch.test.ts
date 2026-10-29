import { DevSettings, I18nManager } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { initI18n, isRTL, locale, setLocaleForTests, switchLanguage } from '../src/i18n';

// In React Native's test mock, isRTL is a plain value. Set it for one test and put it back afterwards.
const native = I18nManager as { isRTL: boolean };
const originalRTL = native.isRTL;

describe('switching language', () => {
  let force: jest.SpyInstance;
  let reload: jest.SpyInstance;

  beforeEach(async () => {
    setLocaleForTests('en');
    await SecureStore.deleteItemAsync('pawspal.locale');
    force = jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => {});
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => {});
    reload = jest.spyOn(DevSettings, 'reload').mockImplementation(() => {});
  });
  afterEach(() => { jest.restoreAllMocks(); native.isRTL = originalRTL; });

  it('English to Arabic: saves the choice, turns on right-to-left and restarts the app', async () => {
    await switchLanguage('ar');
    expect(locale()).toBe('ar');
    expect(isRTL()).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('pawspal.locale', 'ar');
    expect(force).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('Arabic back to English: turns right-to-left off and restarts', async () => {
    setLocaleForTests('ar');
    await switchLanguage('en');
    expect(isRTL()).toBe(false);
    expect(force).toHaveBeenCalledWith(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('choosing the language that is already active does nothing', async () => {
    await switchLanguage('en');
    expect(force).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('on start-up, a saved Arabic choice makes the layout match (one restart if it did not)', async () => {
    await SecureStore.setItemAsync('pawspal.locale', 'ar');
    native.isRTL = false;
    await initI18n();
    expect(locale()).toBe('ar');
    expect(force).toHaveBeenCalledWith(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('on start-up, when the direction already matches there is no restart', async () => {
    await SecureStore.setItemAsync('pawspal.locale', 'ar');
    native.isRTL = true;
    await initI18n();
    expect(force).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('an unreadable or invalid saved value falls back to the device language', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('locked'));
    native.isRTL = false;
    await initI18n();
    expect(locale()).toBe('en');
  });
});
