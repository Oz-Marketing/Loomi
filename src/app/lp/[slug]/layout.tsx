/**
 * Minimal layout for the public landing-page route. LayoutShell
 * short-circuits for /lp/* paths, so this layout's only job is to
 * normalize the body margins + stack columns/grids on narrow
 * viewports the same way the editor's mobile preview does.
 *
 * The root <body> is `display:flex` (it hosts the app's sidebar+main
 * layout). On public LP pages LayoutShell renders the page as the
 * body's lone child, so without an explicit grow it would size to its
 * content (~the inner max-width) and pin to the left, leaving the
 * page's full-bleed bands capped and left-aligned. The `flex-1` wrapper
 * makes the page fill the viewport width so 100%-width sections truly
 * span edge to edge.
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
      <div className="flex-1 min-w-0">{children}</div>
    </>
  );
}
