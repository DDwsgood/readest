// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkForAppUpdates: vi.fn(),
  checkAppReleaseNotes: vi.fn(),
  optOutTelemetry: vi.fn(),
  optInTelemetry: vi.fn(),
  saveSettings: vi.fn().mockResolvedValue(undefined),
  applyBackgroundTexture: vi.fn(),
  applyEinkMode: vi.fn(),
}));

vi.mock('@/i18n/i18n', () => ({
  default: { on: vi.fn(), off: vi.fn(), changeLanguage: vi.fn() },
}));
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/helpers/updater', () => ({
  checkForAppUpdates: mocks.checkForAppUpdates,
  checkAppReleaseNotes: mocks.checkAppReleaseNotes,
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useAppRouter', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  isWebAppPlatform: () => true,
  isPWA: () => false,
  getAPIBaseUrl: () => 'https://api.example.com',
  getNodeAPIBaseUrl: () => 'https://node.example.com',
}));

vi.mock('@/context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    user: { email: 'free@example.com', user_metadata: {} },
    token: 'tok',
  }),
}));

vi.mock('@/context/EnvContext', () => {
  const appService = {
    hasUpdater: true,
    hasWindow: false,
    isMobileApp: false,
    exists: vi.fn().mockResolvedValue(false),
    loadSettings: vi.fn().mockResolvedValue({
      version: 1,
      telemetryEnabled: true,
      globalViewSettings: { uiLanguage: 'en', isEink: false },
    }),
    saveSettings: mocks.saveSettings,
  };
  const envValue = {
    envConfig: { getAppService: async () => appService },
    appService,
  };
  return {
    useEnv: () => envValue,
  };
});

vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', quotas: [] }),
}));

vi.mock('@/hooks/useCloudSyncStatus', () => ({
  useCloudSyncStatus: () => ({
    label: 'Synced',
    needsSignIn: false,
    failed: false,
    syncing: false,
    providers: [],
  }),
}));

vi.mock('@/hooks/useTransferQueue', () => ({
  useTransferQueue: () => ({
    stats: { active: 0, pending: 0, failed: 0 },
    hasActiveTransfers: false,
    setIsTransferQueueOpen: vi.fn(),
  }),
}));

vi.mock('@/hooks/useAppUrlIngress', () => ({ useAppUrlIngress: () => {} }));
vi.mock('@/hooks/useOpenWithBooks', () => ({ useOpenWithBooks: () => {} }));
vi.mock('@/hooks/useOpenLaunchLinks', () => ({ useOpenLaunchLinks: () => {} }));
vi.mock('@/hooks/useHomeScreenWidgets', () => ({ useHomeScreenWidgets: () => {} }));
vi.mock('@/hooks/useOpenShareLink', () => ({ useOpenShareLink: () => {} }));
vi.mock('@/hooks/useOpenDeviceLink', () => ({ useOpenDeviceLink: () => {} }));
vi.mock('@/hooks/useClipUrlIngress', () => ({ useClipUrlIngress: () => {} }));
vi.mock('@/hooks/useRestoreLibraryOnRelaunch', () => ({ useRestoreLibraryOnRelaunch: () => {} }));
vi.mock('@/app/reader/components/Reader', () => ({ default: () => <div>ReaderMounted</div> }));
vi.mock('@/helpers/settings', () => ({
  getLibraryViewSettings: () => ({}),
  saveSysSettings: vi.fn(),
}));
vi.mock('@/utils/window', () => ({
  canToggleFullScreen: () => false,
  tauriHandleSetAlwaysOnTop: vi.fn(),
  toggleFullScreen: vi.fn(),
}));
vi.mock('@/utils/bridge', () => ({
  selectDirectory: vi.fn(),
}));
vi.mock('@/utils/permission', () => ({
  requestStoragePermission: vi.fn(),
}));
vi.mock('@/services/biometric', () => ({
  getBiometricStatus: vi.fn(),
  getBiometryLabelKey: () => '',
  isBiometricSupported: () => false,
}));
vi.mock('@/components/ClipSignInAlert', () => ({ default: () => null }));
vi.mock('@/components/stats/ReadingStatsDialog', () => ({
  setReadingStatsDialogVisible: vi.fn(),
}));
vi.mock('@/components/vocabulary/VocabularyDialog', () => ({
  setVocabularyDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/BackupWindow', () => ({
  setBackupDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/CacheManagerWindow', () => ({
  setCacheManagerDialogVisible: vi.fn(),
}));
vi.mock('@/app/library/components/MigrateDataWindow', () => ({
  setMigrateDataDirDialogVisible: vi.fn(),
}));
vi.mock('@/components/AboutWindow', () => ({
  setAboutDialogVisible: vi.fn(),
}));

vi.mock('@/context/PHContext', () => ({
  CSPostHogProvider: ({ children }: { children: React.ReactNode }) => children,
  initPostHog: vi.fn(),
}));
vi.mock('@/context/SyncContext', () => ({
  SyncProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/context/DropdownContext', () => ({
  DropdownProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('@/components/command-palette', () => ({
  CommandPaletteProvider: ({ children }: { children: React.ReactNode }) => children,
  CommandPalette: () => null,
}));
vi.mock('@/components/WindowResizeHandles', () => ({ default: () => null }));
vi.mock('@/components/WindowOutline', () => ({ default: () => null }));
vi.mock('@/components/AtmosphereOverlay', () => ({ default: () => null }));
vi.mock('@/components/AppLockScreen', () => ({ default: () => null }));
vi.mock('@/components/CarMediaLibraryBridge', () => ({ default: () => null }));
vi.mock('@/components/settings/AppLockDialog', () => ({ default: () => null }));
vi.mock('@/components/PassphrasePrompt', () => ({ default: () => null }));
vi.mock('@/hooks/useSafeAreaInsets', () => ({ useSafeAreaInsets: () => {} }));
vi.mock('@/hooks/useSettingsSync', () => ({ useSettingsSync: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: mocks.applyBackgroundTexture }),
}));
vi.mock('@/hooks/useEinkMode', () => ({
  useEinkMode: () => ({ applyEinkMode: mocks.applyEinkMode }),
}));
vi.mock('@/libs/crypto/passphrase', () => ({
  upgradeToKeychainIfAvailable: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/libs/crypto/session', () => ({
  cryptoSession: { tryRestoreFromStore: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('@/services/sync/replicaSettingsSync', () => ({ initSettingsSync: vi.fn() }));
vi.mock('@/store/themeStore', () => ({
  initSystemThemeListener: vi.fn(),
  loadDataTheme: vi.fn(),
  useThemeStore: () => ({ themeMode: 'light', setThemeMode: vi.fn() }),
}));
vi.mock('@/utils/telemetry', () => ({
  getTelemetryDecision: () => null,
  optInTelemetry: mocks.optInTelemetry,
  optOutTelemetry: mocks.optOutTelemetry,
  reconcileTelemetryConsent: () => false,
}));

import { DEFAULT_SYSTEM_SETTINGS } from '@/services/constants';
import ReaderPage from '@/app/reader/page';
import SettingsMenu from '@/app/library/components/SettingsMenu';
import Providers from '@/components/Providers';

describe('Startup update & promotion suppression', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('defaults autoCheckUpdates to false', () => {
    expect(DEFAULT_SYSTEM_SETTINGS.autoCheckUpdates).toBe(false);
  });

  it('does not run automatic update or release-notes checks when ReaderPage mounts', () => {
    render(<ReaderPage />);
    expect(screen.getByText('ReaderMounted')).toBeTruthy();
    expect(mocks.checkForAppUpdates).not.toHaveBeenCalled();
    expect(mocks.checkAppReleaseNotes).not.toHaveBeenCalled();
  });

  it('omits Upgrade to Readest Premium and Download Readest items from SettingsMenu', () => {
    render(<SettingsMenu onPullLibrary={vi.fn()} />);
    expect(screen.queryByText('Upgrade to Readest Premium')).toBeNull();
    expect(screen.queryByText('Download Readest')).toBeNull();
    expect(screen.getByText('About Readest')).toBeTruthy();
  });

  it('silently opts out brand-new installs without rendering TelemetryConsentDialog', async () => {
    render(
      <Providers>
        <div>AppReady</div>
      </Providers>,
    );
    await waitFor(() => expect(mocks.optOutTelemetry).toHaveBeenCalledOnce());
    expect(mocks.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ telemetryEnabled: false }),
    );
    expect(screen.queryByText('Help improve Readest')).toBeNull();
  });
});
