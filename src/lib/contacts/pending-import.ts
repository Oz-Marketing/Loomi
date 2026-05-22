// Module-level handoff for the New List modal → /contacts/import flow.
//
// The modal picks a File, creates the list, then router.push()es to
// the import page. We can't pass the File through the URL, but the
// soft-navigation keeps the JS module graph alive, so a module-level
// variable survives the hop. The import page consumes it once on
// mount; consume() always clears so we don't accidentally apply a
// stale file to a later session.

let pendingFile: File | null = null;

export function stashPendingImportFile(file: File): void {
  pendingFile = file;
}

export function consumePendingImportFile(): File | null {
  const file = pendingFile;
  pendingFile = null;
  return file;
}
