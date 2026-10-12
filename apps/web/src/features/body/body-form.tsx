'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { bodyMetricKeys } from '../dashboard/dashboard.types';
import { buttonClass } from '../dashboard/dashboard.ui';
import { inputClass } from '../workout/workout.ui';
import { createSubmissionLock } from '../workout/workout-state';
import { instantToLocalInput } from './body-time';
import { bodyMutationMessage } from './body-state';
import {
  measurementDraft,
  validateMeasurementDraft,
  type BodyFormErrors,
} from './body.validation';
import {
  bodyFields,
  type BodyMeasurement,
  type BodyMeasurementInput,
} from './body.types';

export function MeasurementForm({
  measurement,
  disabled,
  onSave,
}: {
  measurement?: BodyMeasurement;
  disabled: boolean;
  onSave: (input: BodyMeasurementInput) => Promise<boolean>;
}) {
  const prefix = useId(),
    lock = useRef(createSubmissionLock());
  const [draft, setDraft] = useState(() => measurementDraft(measurement)),
    [errors, setErrors] = useState<BodyFormErrors>({}),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || !lock.current.acquire()) return;
    const result = validateMeasurementDraft(draft, measurement);
    if (result.errors) {
      setErrors(result.errors);
      lock.current.release();
      return;
    }
    setErrors({});
    setError(null);
    setPending(true);
    try {
      await onSave(result.input);
    } catch (error: unknown) {
      setError(bodyMutationMessage(error));
    } finally {
      lock.current.release();
      setPending(false);
    }
  }
  return (
    <form
      noValidate
      aria-label={
        measurement ? 'Edit body measurement' : 'Add body measurement'
      }
      onSubmit={submit}
      className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      <p className="text-sm leading-6 text-slate-600">
        Record any one or more metrics. Blank metrics are absent, not zero.
        {measurement
          ? ' Clearing a field removes that metric; unchanged fields are not sent.'
          : ''}
      </p>
      <div className="grid grid-cols-2 gap-4">
        {bodyMetricKeys.map((key) => {
          const id = prefix + '-' + key,
            field = bodyFields[key];
          return (
            <div key={key} className="min-w-0">
              <label htmlFor={id} className="text-sm font-medium">
                {field.label} ({field.unit})
              </label>
              <input
                id={id}
                name={key}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                disabled={disabled || pending}
                value={draft[key]}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    [key]: event.target.value,
                  }))
                }
                aria-invalid={!!errors[key]}
                aria-describedby={
                  id + '-hint' + (errors[key] ? ' ' + id + '-error' : '')
                }
                className={inputClass}
              />
              <p id={id + '-hint'} className="mt-1 text-xs text-slate-500">
                Optional · greater than 0, up to {field.maximum}; 2 decimals.
              </p>
              {errors[key] && (
                <p id={id + '-error'} className="mt-1 text-sm text-red-800">
                  {errors[key]}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <div>
        <label htmlFor={prefix + '-time-mode'} className="text-sm font-medium">
          Measurement time
        </label>
        <select
          id={prefix + '-time-mode'}
          name="timeMode"
          disabled={disabled || pending}
          value={draft.timeMode}
          className={inputClass}
          onChange={(event) => {
            const mode = event.target.value;
            if (
              mode === 'now' ||
              mode === 'keep' ||
              mode === 'local' ||
              mode === 'exact'
            )
              setDraft((current) => ({
                ...current,
                timeMode: mode,
                measuredAt: measurement
                  ? mode === 'local'
                    ? instantToLocalInput(measurement.measuredAt)
                    : mode === 'exact'
                      ? measurement.measuredAt
                      : ''
                  : '',
              }));
          }}
        >
          {measurement ? (
            <option value="keep">Keep recorded time</option>
          ) : (
            <option value="now">Now (server time)</option>
          )}
          <option value="local">Local date and time</option>
          <option value="exact">Exact timestamp with timezone</option>
        </select>
        {measurement && draft.timeMode === 'keep' && (
          <p className="mt-2 break-words text-xs text-slate-500">
            Recorded:{' '}
            <time dateTime={measurement.measuredAt}>
              {measurement.measuredAt}
            </time>
            . It will not change.
          </p>
        )}
        {(draft.timeMode === 'local' || draft.timeMode === 'exact') && (
          <div className="mt-4 min-w-0">
            <label
              htmlFor={prefix + '-measuredAt'}
              className="text-sm font-medium"
            >
              Measured at
              {draft.timeMode === 'local'
                ? ' (browser local time)'
                : ' (RFC3339)'}
            </label>
            <input
              id={prefix + '-measuredAt'}
              name="measuredAt"
              type={draft.timeMode === 'local' ? 'datetime-local' : 'text'}
              step="0.001"
              autoComplete="off"
              disabled={disabled || pending}
              value={draft.measuredAt}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  measuredAt: event.target.value,
                }))
              }
              aria-invalid={!!errors.measuredAt}
              aria-describedby={
                prefix +
                '-time-hint' +
                (errors.measuredAt ? ' ' + prefix + '-time-error' : '')
              }
              className={inputClass}
            />
            <p
              id={prefix + '-time-hint'}
              className="mt-2 text-xs leading-5 text-slate-500"
            >
              Local input uses your browser timezone, never UTC implicitly. DST
              gaps are rejected; repeated hours use the earlier offset. Use an
              exact timestamp with Z or ±HH:mm to select another offset. Future
              dates are validated by the server.
            </p>
          </div>
        )}
        {errors.measuredAt && (
          <p id={prefix + '-time-error'} className="mt-1 text-sm text-red-800">
            {errors.measuredAt}
          </p>
        )}
      </div>
      <div>
        <label htmlFor={prefix + '-notes'} className="text-sm font-medium">
          Notes (optional)
        </label>
        <textarea
          id={prefix + '-notes'}
          name="notes"
          rows={3}
          value={draft.notes}
          onChange={(event) =>
            setDraft((current) => ({ ...current, notes: event.target.value }))
          }
          disabled={disabled || pending}
          aria-invalid={!!errors.notes}
          aria-describedby={
            prefix +
            '-notes-hint' +
            (errors.notes ? ' ' + prefix + '-notes-error' : '')
          }
          className={inputClass + ' resize-y'}
        />
        <p id={prefix + '-notes-hint'} className="mt-1 text-xs text-slate-500">
          Up to 1000 characters. Notes do not replace a body metric.
        </p>
        {errors.notes && (
          <p id={prefix + '-notes-error'} className="mt-1 text-sm text-red-800">
            {errors.notes}
          </p>
        )}
      </div>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="text-sm text-red-800">
          {errors.form ?? 'Check the highlighted fields.'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-slate-700">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={disabled || pending}
        className={buttonClass}
      >
        {pending
          ? 'Saving...'
          : measurement
            ? 'Save measurement'
            : 'Add measurement'}
      </button>
    </form>
  );
}
