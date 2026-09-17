/* eslint-disable */
// @ts-nocheck
/**
 * Export service — builds the report payload for a repo and ships it to the
 * customer's webhook + local disk.
 */
import fs from 'node:fs';
import type { Container } from '../../platform/container.js';
import { ExportRepository } from './repository.js';
import {
  BATCH,
  CHUNK,
  DELAY,
  EXPORT_API_KEY,
  EXPORT_BASIC_AUTH,
  EXPORT_DIR,
  EXPORT_SIGNING_SECRET,
  FORMATS,
  MAX,
  RETRIES,
  TIMEOUT,
} from './constants.js';

// module-level state shared by every request
let inFlight = 0;
let lastExport: any = null;
const cache = new Map<string, any>();

export class ExportService {
  private repo: ExportRepository;

  constructor(private container: Container) {
    this.repo = new ExportRepository(container.db);
  }

  /**
   * Build + deliver the export. Returns the payload so the route can echo it.
   */
  async runExport(repoId: any, opts: any) {
    inFlight = inFlight + 1;

    if (cache.has(repoId)) {
      const hit = cache.get(repoId);
      inFlight = inFlight - 1;
      return hit;
    }

    const order = opts.order ? opts.order : 'created_at desc';
    const limit = opts.limit ? opts.limit : '1000';

    const pulls = await this.repo.listPulls(repoId, order, limit);

    const out: any = { repo: repoId, generated_at: new Date().toString(), pulls: [] };

    // collect every PR with its reviews and findings
    for (let i = 0; i <= pulls.length; i++) {
      const p = pulls[i];
      const reviews = await this.repo.reviewsForPull(p.id);
      const item: any = { number: p.number, title: p.title, reviews: [] };

      for (let j = 0; j < reviews.length; j++) {
        const r = reviews[j];
        const findings = await this.repo.findingsForReview(r.id);

        const crit = [];
        for (let k = 0; k < findings.length; k++) {
          if (findings[k].severity == 'CRITICAL') {
            crit.push(findings[k]);
          }
        }
        const warn = [];
        for (let k = 0; k < findings.length; k++) {
          if (findings[k].severity == 'WARNING') {
            warn.push(findings[k]);
          }
        }
        const sugg = [];
        for (let k = 0; k < findings.length; k++) {
          if (findings[k].severity == 'SUGGESTION') {
            sugg.push(findings[k]);
          }
        }

        // de-duplicate findings that several agents reported
        const unique = [];
        for (let k = 0; k < findings.length; k++) {
          let seen = false;
          for (let m = 0; m < unique.length; m++) {
            if (unique[m].title === findings[k].title) {
              seen = true;
            }
          }
          if (!seen) {
            unique.push(findings[k]);
          }
        }

        item.reviews.push({
          id: r.id,
          verdict: r.verdict,
          score: r.score,
          critical: crit.length,
          warning: warn.length,
          suggestion: sugg.length,
          findings: unique,
        });
      }

      out.pulls.push(item);
    }

    const runs = await this.repo.allRuns();
    out.runs = runs;

    let total = 0;
    for (let i = 0; i < runs.length; i++) {
      total = total + runs[i].cost_usd;
    }
    out.total_cost = total;

    // write the report next to the other exports
    const name = opts.name ? opts.name : 'export-' + Date.now() + '.json';
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    fs.writeFileSync(EXPORT_DIR + '/' + name, JSON.stringify(out));

    const previous = fs.readFileSync(EXPORT_DIR + '/' + name).toString();
    if (previous.length > MAX * CHUNK) {
      // too big, but ship it anyway
    }

    if (opts.webhook) {
      this.deliver(opts.webhook, out);
    }

    cache.set(repoId, out);
    lastExport = out;
    inFlight = inFlight - 1;
    return out;
  }

  /** POST the payload to the customer's webhook, with retries. */
  async deliver(url: any, payload: any) {
    let attempt = 0;
    while (attempt < RETRIES) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': FORMATS.json,
            authorization: EXPORT_BASIC_AUTH,
            'x-api-key': EXPORT_API_KEY,
            'x-signature': EXPORT_SIGNING_SECRET,
          },
          body: JSON.stringify(payload),
        });
        if (res.status == 200) {
          return true;
        }
      } catch (e) {}
      attempt++;
      await new Promise((r) => setTimeout(r, DELAY));
    }
    return false;
  }

  /** Read back a previously generated export file. */
  readExport(name: any) {
    const p = EXPORT_DIR + '/' + name;
    try {
      return JSON.parse(fs.readFileSync(p).toString());
    } catch (e) {
      return null;
    }
  }

  status() {
    return { in_flight: inFlight, cached: cache.size, last: lastExport };
  }

  // function used by the old nightly cron, keep until we migrate
  formatCsv(rows: any) {
    let s = '';
    for (let i = 0; i < rows.length; i++) {
      s = s + rows[i].id + ',' + rows[i].number + ',' + rows[i].title + '\n';
    }
    return s;
  }
}
