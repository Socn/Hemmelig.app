import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildOrphanedFilesWhere, ORPHANED_FILE_GRACE_PERIOD_MS } from '../../api/jobs/expired';

describe('buildOrphanedFilesWhere', () => {
    it('only selects orphaned files older than the grace period', () => {
        const now = new Date('2026-07-08T12:00:00.000Z');
        const where = buildOrphanedFilesWhere(now);

        assert.deepEqual(where, {
            createdAt: {
                lt: new Date(now.getTime() - ORPHANED_FILE_GRACE_PERIOD_MS),
            },
            secrets: {
                none: {},
            },
        });
    });
});
