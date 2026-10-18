export function Home() {
  return (
    <>
      <h1>Saydo on React + Vite</h1>
      <p className="lede">Press ⌘K (Ctrl K). Everything you see here, the assistant can see and do.</p>
      <ul className="try">
        <li><code>take me to settings</code></li>
        <li>On Profile: <code>fill name with Ada Lovelace</code>, then <code>click Save profile</code></li>
        <li>On Settings: <code>switch to dark mode</code> (a one-line UI action)</li>
        <li><code>send feedback saying the new palette is great</code> (a server action, confirmed first)</li>
      </ul>
    </>
  );
}
