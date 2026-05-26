/**
 * 404 surface for /lp/<slug> — kept intentionally bare. Doesn't leak
 * whether the slug exists in draft (privacy) or never existed (correct
 * status), and doesn't show Loomi chrome (this is the customer's
 * branded URL, not an app page).
 */
export default function LandingPageNotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
        background: '#fafafa',
        color: '#1a1a1a',
        padding: '24px',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: 420 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 48,
            fontWeight: 800,
            letterSpacing: '-0.02em',
          }}
        >
          404
        </h1>
        <p style={{ marginTop: 12, fontSize: 16, opacity: 0.7 }}>
          We couldn&rsquo;t find that page.
        </p>
      </div>
    </div>
  );
}
