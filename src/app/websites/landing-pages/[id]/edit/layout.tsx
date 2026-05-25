/**
 * Builder workspace chrome — full-viewport, no app shell. LayoutShell
 * strips its sidebar/header when the URL contains "/edit", same as the
 * forms + email editors. PR2 fills this layout with the LP-specific
 * FormDetailHeader equivalent (back button, autosave indicator,
 * publish toggle, settings cog).
 */
export default function LandingPageBuilderLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="flex flex-col h-[calc(100vh-2rem)]">{children}</div>;
}
