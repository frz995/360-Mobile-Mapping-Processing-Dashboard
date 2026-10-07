/**
 * Reading and writing the survey metadata filename set (migration 0034).
 *
 * WHY A SEPARATE MODULE
 *
 * `csv_file_name` on `staging_panoramas` stores the CSV's NAME. This stores its
 * ROWS. Keeping them apart stops anyone reading the name column and concluding
 * the metadata is persisted, which is the mistake migration 0034's header
 * documents at length.
 *
 * WHY IT IS WRITTEN AT IMPORT AND NEVER AFTER
 *
 * `handleCsvImport` is the only moment the parsed rows exist — they are
 * component state, cleared when the dialog closes. Every later read is a
 * reconstruction from the database. A re-import upserts, so re-running an
 * import is idempotent rather than accumulating the duplicates the panel is
 * supposed to be measuring.
 */

import { supabase, scoped, getServiceProjectId } from './client';

/** Column set, so the two functions cannot drift apart. */
const COLUMNS = 'subgrid, run_id, csv_file_name, filename';

export interface MetadataFilenameRow {
  subgrid: string;
  run_id: string | null;
  csv_file_name: string | null;
  filename: string;
}

/** Rows are written in batches; a 284k-row CSV must not be one statement. */
const INSERT_BATCH_SIZE = 500;

function requireProjectId(): string {
  const pid = getServiceProjectId();
  if (!pid) {
    throw new Error(
      'Cannot record survey metadata filenames without an active project. ' +
        'The rows are project-scoped, so there is nowhere to put them.'
    );
  }
  return pid;
}

/**
 * Persist the filename set for one run.
 *
 * Best-effort by design at the call site: a failure here must not abort a CSV
 * import that has already been validated. The consequence is that the panel's
 * three metadata rows read "not captured" for that run, which is accurate —
 * they were not, in fact, captured.
 *
 * Returns the count actually written so the caller can report a partial write
 * rather than claiming success.
 */
export async function saveSurveyMetadataFilenames(
  subgrid: string,
  runId: string | null,
  csvFileName: string | null,
  filenames: string[]
): Promise<number> {
  const unique = Array.from(new Set(filenames.map((f) => (f ?? '').trim()).filter(Boolean)));
  if (unique.length === 0) return 0;

  const projectId = requireProjectId();
  let written = 0;

  for (let i = 0; i < unique.length; i += INSERT_BATCH_SIZE) {
    const chunk = unique.slice(i, i + INSERT_BATCH_SIZE).map((filename) => ({
      project_id: projectId,
      subgrid,
      run_id: runId,
      csv_file_name: csvFileName,
      filename
    }));

    const { error } = await supabase
      .from('survey_metadata_filenames')
      // onConflict names the table's unique constraint. Re-importing the same
      // CSV then updates rather than duplicating, so a re-run cannot manufacture
      // the duplicate condition this table exists to measure.
      .upsert(chunk, {
        onConflict: 'project_id,subgrid,run_id,filename',
        ignoreDuplicates: true
      });

    if (error) {
      // Surfaced rather than swallowed: an operator told an import completed
      // should learn that the metadata half did not persist.
      console.warn('survey_metadata_filenames write failed:', error.message);
      return written;
    }
    written += chunk.length;
  }

  return written;
}

/**
 * Read the filename set for one run.
 *
 * Returns `null` — NOT an empty array — when the table is unreachable or the
 * rows do not exist, because those are different answers:
 *
 *   []      the metadata was captured and declared no filenames
 *   null    the metadata was never captured (pre-0034) or cannot be read
 *
 * The panel renders `null` as "not captured at import". Returning `[]` there
 * would render as "captured, and nothing is wrong", which is the exact
 * confusion migration 0032 produced.
 */
export async function fetchSurveyMetadataFilenames(
  subgrid: string,
  runId: string | null
): Promise<string[] | null> {
  try {
    let query = supabase
      .from('survey_metadata_filenames')
      .select(COLUMNS)
      .eq('subgrid', subgrid)
      .limit(50000);

    // A NULL run_id cannot be compared with `eq`; `is` is required.
    query = runId === null ? query.is('run_id', null) : query.eq('run_id', runId);

    const { data, error } = await scoped(query);

    if (error) {
      console.warn(
        'survey_metadata_filenames unreadable — metadata rows will show as not captured:',
        error.message
      );
      return null;
    }

    return (data ?? []).map((r: MetadataFilenameRow) => r.filename).filter(Boolean);
  } catch (err) {
    console.warn('survey_metadata_filenames read failed:', err);
    return null;
  }
}