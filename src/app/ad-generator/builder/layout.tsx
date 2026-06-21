/**
 * Workspace chrome for the Ad Template Builder.
 *
 * Mirrors the forms / landing-page builders: LayoutShell's isAdBuilder branch
 * strips the app sidebar + utility bar for a focused, full-viewport editor,
 * and this layout provides the calc-sized flex column the builder page fills.
 * (The parent ad-generator layout still gates the whole tool on the flag.)
 */
export default function AdBuilderLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex h-[calc(100vh-2rem)] flex-col">{children}</div>;
}
