import Link from 'next/link';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export default async function Billing({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const invoices = db.invoices.filter((i) => !status || i.status === status);
  return (
    <>
      <h1>Billing</h1>
      <p className="lede">
        Filter:{' '}
        <Link href="/billing">all</Link> · <Link href="/billing?status=paid">paid</Link> ·{' '}
        <Link href="/billing?status=unpaid">unpaid</Link>
      </p>
      {/* Private: never sent to the model, never operable. */}
      <div className="card row" data-saydo-private style={{ marginBottom: 16 }}>
        <span>Card on file</span>
        <span>•••• 4242 · exp 08/29</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => (
            <tr key={invoice.id}>
              <td>{invoice.id}</td>
              <td>{invoice.date}</td>
              <td>${(invoice.amount / 100).toFixed(2)}</td>
              <td>
                <span className={`pill ${invoice.status === 'paid' ? 'ok' : 'warn'}`}>{invoice.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
