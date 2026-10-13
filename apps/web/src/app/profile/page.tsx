import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ProfileClient } from '@/features/profile/profile-client';
import { WorkoutLoading } from '@/features/workout/workout.ui';
export const metadata: Metadata = { title: 'Profile | Gym App' };
export default function ProfilePage() {
  return (
    <Suspense
      fallback={
        <main id="main-content" className="mx-auto max-w-2xl px-4 py-8">
          <WorkoutLoading label="Loading profile..." />
        </main>
      }
    >
      <ProfileClient />
    </Suspense>
  );
}
