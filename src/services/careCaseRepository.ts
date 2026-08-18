import type { Pool } from "pg";
import type { CareCase } from "../domain/customerCare.js";

export interface CareCaseRepository {
  save(careCase: CareCase): Promise<void> | void;
  findById(id: string): Promise<CareCase | undefined> | CareCase | undefined;
}

export class InMemoryCareCaseRepository implements CareCaseRepository {
  private readonly cases = new Map<string, CareCase>();

  save(careCase: CareCase): void {
    this.cases.set(careCase.id, cloneCareCase(careCase));
  }

  findById(id: string): CareCase | undefined {
    const value = this.cases.get(id);
    return value ? cloneCareCase(value) : undefined;
  }

  list(): CareCase[] {
    return [...this.cases.values()].map(cloneCareCase);
  }
}

export class PgCareCaseRepository implements CareCaseRepository {
  constructor(private readonly pool: Pool) {}

  async save(careCase: CareCase): Promise<void> {
    await this.pool.query(
      `INSERT INTO care_cases (
         id, issue_type, priority, owner, due_at, bot_paused, facts, status,
         acknowledged_at, resolution_summary, closed_at, updates, created_at, updated_at
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12::jsonb,$13,$14
       )
       ON CONFLICT (id) DO UPDATE SET
         owner=EXCLUDED.owner,
         due_at=EXCLUDED.due_at,
         bot_paused=EXCLUDED.bot_paused,
         facts=EXCLUDED.facts,
         status=EXCLUDED.status,
         resolution_summary=EXCLUDED.resolution_summary,
         closed_at=EXCLUDED.closed_at,
         updates=EXCLUDED.updates,
         updated_at=EXCLUDED.updated_at`,
      [
        careCase.id,
        careCase.issue,
        careCase.priority,
        careCase.owner,
        careCase.dueAt,
        careCase.botPaused,
        JSON.stringify(careCase.facts),
        careCase.status,
        careCase.acknowledgedAt,
        careCase.resolutionSummary ?? null,
        careCase.closedAt ?? null,
        JSON.stringify(careCase.updates),
        careCase.createdAt,
        careCase.updatedAt,
      ],
    );
  }

  async findById(id: string): Promise<CareCase | undefined> {
    const result = await this.pool.query(
      `SELECT id::text, issue_type, priority, owner, due_at, bot_paused, facts,
              status, acknowledged_at, resolution_summary, closed_at, updates,
              created_at, updated_at
       FROM care_cases WHERE id=$1`,
      [id],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return undefined;
    return {
      id: String(row.id),
      issue: row.issue_type as CareCase["issue"],
      priority: row.priority as CareCase["priority"],
      owner: String(row.owner),
      dueAt: new Date(String(row.due_at)),
      createdAt: new Date(String(row.created_at)),
      updatedAt: new Date(String(row.updated_at)),
      acknowledgedAt: new Date(String(row.acknowledged_at)),
      ...(row.closed_at ? { closedAt: new Date(String(row.closed_at)) } : {}),
      ...(row.resolution_summary
        ? { resolutionSummary: String(row.resolution_summary) }
        : {}),
      botPaused: Boolean(row.bot_paused),
      facts: (row.facts ?? {}) as Record<string, unknown>,
      status: row.status as CareCase["status"],
      updates: Array.isArray(row.updates)
        ? (row.updates as CareCase["updates"]).map((update) => ({
            ...update,
            at: new Date(update.at),
          }))
        : [],
    };
  }
}

function cloneCareCase(careCase: CareCase): CareCase {
  return {
    ...careCase,
    dueAt: new Date(careCase.dueAt),
    createdAt: new Date(careCase.createdAt),
    updatedAt: new Date(careCase.updatedAt),
    acknowledgedAt: new Date(careCase.acknowledgedAt),
    ...(careCase.closedAt ? { closedAt: new Date(careCase.closedAt) } : {}),
    facts: { ...careCase.facts },
    updates: careCase.updates.map((update) => ({
      ...update,
      at: new Date(update.at),
    })),
  };
}
