'use client';

/**
 * A way for the canvas to tell the palette that the saved-block list changed.
 *
 * "Save as custom block" lives on a block's floating toolbar, several levels
 * inside the canvas; the list it adds to is fetched by the shell, several
 * levels the other way. With no channel between them the save succeeded and
 * the palette went on showing the list it fetched on mount — the block was
 * really there, but only a refresh proved it.
 *
 * Its own context rather than a field on `EditorContext`: that one describes
 * the DOCUMENT being edited (blocks, selection, settings), and saved blocks are
 * library state that outlives any one template. It is also why this is a
 * refetch and not an optimistic append — the server assigns the id and applies
 * the scope, so the authoritative list is the one it returns.
 */
import * as React from 'react';

const CustomBlocksContext = React.createContext<{ refresh: () => void }>({
  // No provider (a test rendering the canvas alone, say) means nothing to
  // refresh — the save still works, so this must not throw.
  refresh: () => {},
});

export function CustomBlocksProvider({
  refresh,
  children,
}: {
  refresh: () => void;
  children: React.ReactNode;
}) {
  const value = React.useMemo(() => ({ refresh }), [refresh]);
  return <CustomBlocksContext.Provider value={value}>{children}</CustomBlocksContext.Provider>;
}

/** Re-fetch the saved-block list — call after saving or deleting one. */
export function useRefreshCustomBlocks(): () => void {
  return React.useContext(CustomBlocksContext).refresh;
}
