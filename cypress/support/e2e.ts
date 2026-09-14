/**
 * Loaded before every e2e spec.
 */
import './commands';

/**
 * No blanket `uncaught:exception` handler. A React error escaping to the
 * window is a real defect, and swallowing all of them is how a suite ends up
 * green on a broken page. Each entry below is a specific, justified exception.
 */
Cypress.on('uncaught:exception', (err) => {
  /**
   * React's dev-only performance track calls `performance.measure()` with a
   * start time that predates the navigation Cypress drove, and Chrome rejects
   * the negative timestamp. It is instrumentation, not product code, and
   * `next build` strips it — so this never fires against the production
   * bundle that CI exercises. It only shows up when you point the suite at
   * `next dev`, which is the normal local workflow.
   */
  if (/cannot have a negative time stamp/.test(err.message)) return false;

  // Everything else still fails the test.
  return undefined;
});
