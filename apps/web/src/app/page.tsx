import Link from 'next/link';

export default function Home() {
  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center"
    >
      <h1 className="text-4xl font-bold">Gym App</h1>
      <p className="text-lg text-slate-600">
        Track your workouts. Measure your progress.
      </p>
      <nav
        aria-label="Main navigation"
        className="mt-4 flex flex-wrap justify-center gap-3"
      >
        <Link
          href="/workout"
          className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Workout
        </Link>
        <Link
          href="/dashboard"
          className="rounded-lg bg-slate-900 px-5 py-3 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Dashboard
        </Link>
        <Link
          href="/login"
          className="rounded-lg border border-slate-300 px-5 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          Sign in
        </Link>
      </nav>
    </main>
  );
}
