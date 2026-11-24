-- Two triggers could each find no active job for a book and both queue one.
-- Keep one active job per book and type (a running one first, then the
-- oldest) and cancel the rest, so the unique index below can be built.
UPDATE job
SET
  status = 'CANCELED',
  finished_at = CURRENT_TIMESTAMP,
  error = 'Duplicate of another active job for this book'
WHERE
  status IN ('QUEUED', 'RUNNING', 'PAUSED')
  AND book_uuid IS NOT NULL
  AND EXISTS (
    SELECT
      1
    FROM
      job AS keeper
    WHERE
      keeper.book_uuid = job.book_uuid
      AND keeper.type = job.type
      AND keeper.uuid != job.uuid
      AND keeper.status IN ('QUEUED', 'RUNNING', 'PAUSED')
      AND (
        (keeper.status = 'RUNNING') > (job.status = 'RUNNING')
        OR (
          (keeper.status = 'RUNNING') = (job.status = 'RUNNING')
          AND (
            keeper.created_at < job.created_at
            OR (
              keeper.created_at = job.created_at
              AND keeper.uuid < job.uuid
            )
          )
        )
      )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_job_one_active_per_book ON job (book_uuid, type)
WHERE
  status IN ('QUEUED', 'RUNNING', 'PAUSED');

-- How many server starts found this job running. A job that was running
-- through two consecutive restarts is failed instead of resumed again.
ALTER TABLE job
ADD COLUMN interrupted_count INTEGER NOT NULL DEFAULT 0;

INSERT
OR IGNORE INTO settings (name, value)
VALUES
  ('syncNarrationAutomatically', 'false');
