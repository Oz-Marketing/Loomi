/**
 * Minimal layout for the public form route. The global LayoutShell
 * short-circuits for /f/* paths (see src/components/layout-shell.tsx)
 * so this layout's only job is to inject a tiny stylesheet that
 * stacks Columns blocks on narrow viewports — mirrors the Canvas
 * mobile preview rule so embedded forms look right in iframes
 * narrower than ~500px.
 */
export default function PublicFormLayout({
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
            @media (max-width: 500px) {
              .loomi-form-root .loomi-form-stack {
                flex-basis: 100% !important;
                width: 100% !important;
              }
              .loomi-form-root [data-form-columns-row] {
                flex-direction: column !important;
              }
            }
            body { margin: 0; }
          `,
        }}
      />
      {children}
    </>
  );
}
