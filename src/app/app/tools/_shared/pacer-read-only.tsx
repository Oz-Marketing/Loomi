'use client';

import { createContext, useContext } from 'react';

/**
 * Read-only context for the pacer/planner (Change 5). True when the viewed
 * month is frozen, so editable primitives (DollarInput, the ad editor) and
 * mutation buttons disable themselves without prop-threading. The data layer
 * (autosave suppression + server 409 guards) is the real lock; this is the UX.
 *
 * Shared by the Meta + Google ad tools — both wrap their tree in
 * `PacerReadOnlyContext.Provider` and the leaf inputs read it via the hook.
 */
export const PacerReadOnlyContext = createContext(false);
export const usePacerReadOnly = () => useContext(PacerReadOnlyContext);
