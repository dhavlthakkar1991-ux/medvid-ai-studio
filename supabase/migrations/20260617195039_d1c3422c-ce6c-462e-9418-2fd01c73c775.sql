WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY pipeline_run_id, task_name
      ORDER BY
        CASE status
          WHEN 'completed' THEN 1
          WHEN 'completed_with_warnings' THEN 2
          WHEN 'failed' THEN 3
          WHEN 'running' THEN 4
          ELSE 5
        END,
        completed_at DESC NULLS LAST,
        created_at DESC,
        id
    ) AS rn
  FROM public.task_executions
  WHERE pipeline_run_id IS NOT NULL
)
DELETE FROM public.task_executions t
USING ranked r
WHERE t.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS task_executions_one_per_task_per_run_idx
  ON public.task_executions(pipeline_run_id, task_name)
  WHERE pipeline_run_id IS NOT NULL;

UPDATE public.jobs j
SET state = p.status,
    progress = 100,
    error = NULL
FROM public.projects p
WHERE p.id = j.project_id
  AND p.status IN ('completed', 'completed_with_warnings', 'needs_review')
  AND j.state IN ('queued', 'transcribing', 'analyzing');