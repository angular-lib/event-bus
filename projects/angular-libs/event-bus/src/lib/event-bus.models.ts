/**
 * Base configuration for transforming an event's payload.
 * @template TPayload The type of the original event payload.
 * @template TTransformed The type of the transformed payload.
 */
export interface TransformOptions<TPayload, TTransformed> {
  transform?: (payload: TPayload) => TTransformed;
}

/**
 * Configuration for the callback-based `on` and `once` methods.
 */
export interface SubscriptionOptions<TPayload, TTransformed>
  extends TransformOptions<TPayload, TTransformed> {
  callback: (payload: TTransformed) => void | Promise<void>;
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
  callback: (payloads: TransformedPayloads<TSources>) => void | Promise<void>;
}

// --- INTERNAL TYPES ---

export interface BusEvent<TPayload> {
  key: string;
  payload: TPayload;
  timestamp: number;
}

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
