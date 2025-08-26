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
export interface SubscriptionOptions<TPayload, TTransformed>
  extends TransformOptions<TPayload, TTransformed> {
  /** Unsubscribe from the event when this signal is truthy, or DestroyRef, or when another event key(s) has fired. */
  callback: (event: BusEvent<TTransformed>) => void | Promise<void>;
  /** Unsubscribe from the event when this signal is truthy or when the component is destroyed. */
  unsubscribeOn?: DestroyRef | Signal<any> | string | string[];
}

/**
 * Defines a single event source for `combineLatest` methods.
 */
export interface CombineLatestSource<TPayload = any, TTransformed = TPayload>
  extends TransformOptions<TPayload, TTransformed> {
  key: string;
}

/**
 * Configuration for the callback-based `combineLatest` method.
 */
export interface CombineLatestOptions<
  TSources extends readonly CombineLatestSource[]
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

export type TransformedPayloads<
  TSources extends readonly CombineLatestSource[]
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
