/**
 * Minimal layout for the public landing-page route. LayoutShell
 * short-circuits for /lp/* paths, so this layout's only job is to
 * normalize the body margins + stack columns/grids on narrow
 * viewports the same way the editor's mobile preview does.
 */
export default function PublicLandingPageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            body { margin: 0; }
            @media (max-width: 600px) {
              .loomi-lp-root [data-lp-columns-row] {
                flex-direction: column !important;
              }
              .loomi-lp-root .loomi-lp-column {
                flex: 1 1 100% !important;
                width: 100% !important;
              }
              /* Drop feature-grid + similar CSS Grids down to one column
                 on phones. The renderer sets grid-template-columns inline
                 so we override at the leaf level. */
              .loomi-lp-root [style*="grid-template-columns"] {
                grid-template-columns: 1fr !important;
              }
            }
          `,
        }}
      />
      {children}
    </>
  );
}
