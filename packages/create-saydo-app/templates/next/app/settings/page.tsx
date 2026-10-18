import { settings } from '@/lib/settings';
import { updateSettings } from './actions';

export const dynamic = 'force-dynamic';

async function save(formData: FormData) {
  'use server';
  await updateSettings(formData);
}

export default function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <p className="lede">The assistant can read and fill this form like you would. Saving asks you first.</p>
      <form action={save} className="stack card" data-saydo="Profile settings" data-saydo-risk="write">
        <label>
          Display name
          <input type="text" name="displayName" defaultValue={settings.displayName} />
        </label>
        <label>
          Language
          <select name="language" defaultValue={settings.language}>
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="fr">Français</option>
          </select>
        </label>
        <label>
          <input type="checkbox" name="emailNotifications" defaultChecked={settings.emailNotifications} /> Email notifications
        </label>
        <div>
          <button className="primary" type="submit">
            Save settings
          </button>
        </div>
      </form>
      <div className="card row" style={{ marginTop: 16 }}>
        <span>Delete account</span>
        {/* data-saydo-risk="never": the assistant can point here but never press it. */}
        <button type="button" className="danger" data-saydo-risk="never">
          Delete account
        </button>
      </div>
    </>
  );
}
