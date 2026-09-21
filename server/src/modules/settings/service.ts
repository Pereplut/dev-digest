import type {
  ConnTestRequest,
  ConnTestResult,
  SecretsStatus,
  Settings,
  SettingsUpdate,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { SettingsRepository } from './repository/settings.repo.js';
import { rowsToSettings } from './helpers.js';
import { GITHUB_PROVIDER, SECRET_KEY_BY_PROVIDER } from './constants.js';

/**
 * F1 — settings service. Non-secret workspace preferences, which provider keys
 * are configured, and a live connection test.
 *
 * Secret VALUES are never stored here and never returned: they go through
 * SecretsProvider, and `secretsStatus` reports booleans only.
 */

export class SettingsService {
  constructor(
    private container: Container,
    private repo: SettingsRepository = new SettingsRepository(container.db),
  ) {}

  async get(workspaceId: string): Promise<Settings> {
    return rowsToSettings(await this.repo.listForWorkspace(workspaceId));
  }

  /**
   * Upsert the supplied keys and return the full resulting settings.
   *
   * The loop is one statement per key and is NOT wrapped in a transaction —
   * unchanged from before the extraction. A failure midway leaves earlier keys
   * applied. That is a real atomicity gap (plan item D2's shape), deliberately
   * left alone here so this stays a pure refactor.
   */
  async update(workspaceId: string, userId: string, body: SettingsUpdate): Promise<Settings> {
    for (const [key, value] of Object.entries(body)) {
      await this.repo.upsert(workspaceId, userId, key, value);
    }
    return rowsToSettings(await this.repo.listForWorkspace(workspaceId));
  }

  /** Which provider keys are configured — booleans only, never the values. */
  async secretsStatus(): Promise<SecretsStatus> {
    const entries = await Promise.all(
      (Object.entries(SECRET_KEY_BY_PROVIDER) as [keyof SecretsStatus, string][]).map(
        async ([provider, key]) =>
          [provider, Boolean(await this.container.secrets.get(key))] as const,
      ),
    );
    return Object.fromEntries(entries) as SecretsStatus;
  }

  /**
   * Test a provider key with a cheap live call (listModels / GET user).
   *
   * NOTE: a supplied key is PERSISTED BEFORE the test, so the rest of the app
   * picks it up immediately — including when the test then fails. That is
   * pre-existing behaviour (plan item F9 proposes changing it) and is not
   * altered by this extraction.
   */
  async testConnection(input: ConnTestRequest): Promise<ConnTestResult> {
    const { provider, key } = input;
    try {
      if (key) {
        if (!this.container.secrets.set) {
          return { provider, ok: false, message: 'Secrets backend is read-only' };
        }
        await this.container.secrets.set(SECRET_KEY_BY_PROVIDER[provider], key);
        this.container.invalidateSecretCaches();
      }
      if (provider === GITHUB_PROVIDER) {
        const gh = await this.container.github();
        const login = await gh.currentLogin();
        return { provider, ok: true, message: `Connected as @${login}` };
      }
      const llm = await this.container.llm(provider);
      const models = await llm.listModels();
      return { provider, ok: true, message: `OK — ${models.length} models available` };
    } catch (err) {
      return { provider, ok: false, message: (err as Error).message };
    }
  }
}
