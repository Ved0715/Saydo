import { useState } from 'react';

// No Saydo code at all: the assistant reads and operates this form like a user.
export function Profile() {
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  return (
    <>
      <h1>Profile</h1>
      <form
        className="card stack"
        aria-label="Profile"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(`${name || 'Anonymous'} — ${bio || 'no bio'}`);
        }}
      >
        <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Bio <textarea value={bio} onChange={(e) => setBio(e.target.value)} /></label>
        <label>Password <input type="password" autoComplete="new-password" /></label>
        <div><button className="primary" type="submit">Save profile</button></div>
      </form>
      {saved && <p role="status">Saved: {saved}</p>}
    </>
  );
}
