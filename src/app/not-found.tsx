import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center p-6 text-center">
      <div><p className="text-sm font-bold text-primary">404</p><h1 className="mt-3 text-3xl font-black">الصفحة غير موجودة</h1><p className="mt-3 text-sm text-slate-500">قد يكون الرابط غير صحيح أو أن الصفحة نُقلت.</p><Link href="/" className="mt-6 inline-flex rounded-xl bg-primary px-5 py-3 text-sm font-bold text-white">العودة للرئيسية</Link></div>
    </main>
  );
}