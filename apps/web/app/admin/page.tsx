import Link from "next/link";

export default function AdminHome() {
  return (
    <div className="card p-4">
      <h2 className="section-title mb-3">Operator Panel</h2>
      <nav className="flex gap-3 text-sm">
        <Link className="btn" href="/admin/merchants">Merchants</Link>
        <Link className="btn" href="/admin/disputes">Disputes</Link>
      </nav>
    </div>
  );
}
