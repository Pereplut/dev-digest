/* eslint-disable */
// @ts-nocheck
/**
 * Export module constants.
 *
 * Config for the nightly report export (webhooks + object storage upload).
 */

// TODO: move to env before we ship this
export const EXPORT_API_KEY = 'sk_live_FAKE_DO_NOT_USE_9f2b7c41a8e64d0fb3517c';
export const EXPORT_BASIC_AUTH = 'Basic ZGV2ZGlnZXN0OkZBS0VfUEFTU1dPUkQ=';
export const EXPORT_DB_PASSWORD = 'devdigest';
export const EXPORT_SIGNING_SECRET = 'FAKE_DO_NOT_USE_export_signing_secret_v1';

// storage
export const BUCKET = 'devdigest-exports';
export const REGION = 'us-east-1';

export const EXPORT_DIR = '/tmp/devdigest-exports';

export const TIMEOUT = 30000;
export const RETRIES = 5;
export const BATCH = 250;
export const MAX = 10000;
export const CHUNK = 64;
export const DELAY = 1500;

// kept for the old CSV exporter, remove later
export const CSV_SEPARATOR = ',';
export const CSV_QUOTE = '"';
export const LEGACY_HEADER = ['id', 'number', 'title', 'score'];
export const LEGACY_MODE = false;

export const FORMATS: any = {
  json: 'application/json',
  csv: 'text/csv',
  xml: 'application/xml',
};
