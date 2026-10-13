'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { apiClient, ApiError } from '../../lib/api-client';
import { AppHeader } from '../navigation/app-header';
import { buttonClass } from '../dashboard/dashboard.ui';
import { WorkoutError, WorkoutLoading } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { authReturnPath } from '../auth/return-path';
import { onboardingPath } from '../auth/onboarding-routing';
import { ProfileForm } from './profile-form';
import { ambiguousProfileWrite } from './profile-state';
import type { Profile, ProfileChanges } from './profile.types';

export function ProfileClient({
  onboarding = false,
}: {
  onboarding?: boolean;
}) {
  const router = useRouter(),
    params = useSearchParams(),
    lock = useRef(createSubmissionLock()),
    mounted = useRef(true),
    reconcilingCreate = useRef(false);
  const destination = authReturnPath(params.get('returnTo')),
    [retry, setRetry] = useState(0),
    [resource, setResource] = useState<{
      key: number;
      profile: Profile | null;
    } | null>(null),
    [failure, setFailure] = useState<number | null>(null),
    [pending, setPending] = useState(false),
    [blocked, setBlocked] = useState(false),
    [revision, setRevision] = useState(0),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    void apiClient
      .getProfile(controller.signal)
      .then((profile) => {
        if (controller.signal.aborted) return;
        if (onboarding && profile) {
          router.replace(reconcilingCreate.current ? destination : '/profile');
          return;
        }
        if (!onboarding && !profile) {
          router.replace(onboardingPath('/profile'));
          return;
        }
        setResource({ key: retry, profile });
        setBlocked(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' +
              new URLSearchParams({
                returnTo: onboarding ? destination : '/profile',
              }),
          );
        else setFailure(retry);
      });
    return () => {
      controller.abort();
      mounted.current = false;
    };
  }, [onboarding, destination, retry, router]);
  async function save(input: ProfileChanges): Promise<boolean> {
    if (resource?.key !== retry || blocked || !lock.current.acquire())
      return false;
    setPending(true);
    setSaved(false);
    let navigating = false;
    try {
      if (onboarding) {
        if (typeof input.displayName !== 'string')
          throw new ApiError('configuration');
        try {
          await apiClient.createProfile({
            ...input,
            displayName: input.displayName,
          });
        } catch (error: unknown) {
          if (!(error instanceof ApiError && error.status === 409)) throw error;
          reconcilingCreate.current = true;
          const existing = await apiClient.getProfile();
          if (!existing) {
            setBlocked(true);
            throw error;
          }
        }
        navigating = true;
        if (mounted.current) router.replace(destination);
      } else {
        const profile = await apiClient.updateProfile(input);
        if (mounted.current) {
          setResource({ key: retry, profile });
          setRevision((value) => value + 1);
          setSaved(true);
        }
      }
      return true;
    } catch (error: unknown) {
      if (mounted.current) {
        if (error instanceof ApiError && error.kind === 'unauthorized')
          router.replace(
            '/login?' +
              new URLSearchParams({
                returnTo: onboarding ? destination : '/profile',
              }),
          );
        if (
          ambiguousProfileWrite(error) ||
          reconcilingCreate.current ||
          (error instanceof ApiError && error.status === 404)
        ) {
          setBlocked(true);
          if (onboarding) reconcilingCreate.current = true;
        }
      }
      throw error;
    } finally {
      if (!navigating) {
        lock.current.release();
        if (mounted.current) setPending(false);
      }
    }
  }
  const loaded = resource?.key === retry ? resource : null;
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader active="profile" />
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <h1 className="mb-3 text-3xl font-semibold tracking-tight">
          {onboarding ? 'Set up your profile' : 'Profile'}
        </h1>
        <p className="mb-6 text-sm text-slate-500">
          {onboarding
            ? 'Create your profile to finish onboarding. Only display name is required.'
            : 'Your relatively stable preferences. Body weight belongs to Body Measurements.'}
        </p>
        {loaded ? (
          <ProfileForm
            key={retry + ':' + revision}
            profile={loaded.profile ?? undefined}
            today={new Date().toISOString().slice(0, 10)}
            disabled={pending || blocked}
            onSave={save}
          />
        ) : failure === retry ? (
          <WorkoutError
            title="Profile unavailable"
            onRetry={() => setRetry((value) => value + 1)}
          />
        ) : (
          <WorkoutLoading label="Checking profile..." />
        )}
        {saved && (
          <p role="status" className="mt-4 text-sm font-medium">
            Profile saved.
          </p>
        )}
        {blocked && (
          <div role="alert" className="mt-5 text-sm">
            <p>
              Reload to reconcile your profile before another write. Unsaved
              drafts will be discarded.
            </p>
            <button
              type="button"
              disabled={pending}
              className={buttonClass + ' mt-3'}
              onClick={() => setRetry((value) => value + 1)}
            >
              Reload profile
            </button>
          </div>
        )}
        {!onboarding && (
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/dashboard" className={buttonClass}>
              Open Dashboard
            </Link>
            <Link href="/body" className={buttonClass}>
              Body Measurements
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
