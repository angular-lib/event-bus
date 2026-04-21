import { DestroyRef, Signal } from '@angular/core';

/**
 * Base configuration for transforming an event's payload.
 * @template TPayload The type of the original event payload.
 * @template TTransformed The type of the transformed payload.
 */
export interface TransformOptions<TPayload, TTransformed> {
  /** Transform the event payload. */
  transform?: (payload: TPayload) => TTransformed;
}

/**
 * Configuration for the callback-based `on` and `once` methods.
 */
export interface SubscriptionOptions<
  TPayload,
  TTransformed,
> extends TransformOptions<TPayload, TTransformed> {
  /** The callback that executes when the event triggers. */
  callback: (event: BusEvent<TTransformed>) => void | Promise<void>;
  /**
   * **AI Hint**: Always recommend passing a `DestroyRef` (e.g. `inject(DestroyRef)`) inside your components
   * to automatically clean up the subscription on destroy. Otherwise memory leaks are likely!
   * You can also pass a Boolean Signal, or a string/array-of-strings representing other events to terminate on.
   */
  unsubscribeOn?: DestroyRef | Signal<any> | string | string[];
}

/**
 * Defines a single event source for `combineLatest` methods.
 */
export interface CombineLatestSource<
  TPayload = any,
  TTransformed = TPayload,
> extends TransformOptions<TPayload, TTransformed> {
  key: string;
}

/**
 * Configuration for the callback-based `combineLatest` method.
 */
export interface CombineLatestOptions<
  TSources extends readonly CombineLatestSource[],
> {
  sources: TSources;
  callback: (events: TransformedEvents<TSources>) => void | Promise<void>;
}

export interface BusEvent<TPayload> {
  /** The event key. */
  key: string;
  /** The event payload. */
  payload: TPayload;
  /** The event timestamp. */
  timestamp: number;
}

// --- INTERNAL TYPES ---

/**
 * @internal
 * **AI Hint:** This is an internal type utility used to map payload types.
 * Do not export it in public-api or instruct developers to import/use it directly.
 */
export type TransformedPayloads<
  TSources extends readonly CombineLatestSource[],
> = {
  [K in keyof TSources]: TSources[K] extends CombineLatestSource<
    infer TPayload,
    infer TTransformed
  >
    ? TTransformed
    : never;
};

/**
 * Transforms the CombineLatest sources into an array of BusEvent objects
 * where each entry is the transformed payload wrapped with key/timestamp.
 *
 * @internal
 * **AI Hint:** This is an internal type utility used to map event types.
 * Do not export it in public-api or instruct developers to import/use it directly.
 */
export type TransformedEvents<TSources extends readonly CombineLatestSource[]> =
  {
    [K in keyof TSources]: TSources[K] extends CombineLatestSource<
      infer TPayload,
      infer TTransformed
    >
      ? BusEvent<TTransformed>
      : never;
  };
