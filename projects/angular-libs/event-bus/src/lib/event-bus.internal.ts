import { CombineLatestSource, BusEvent } from './event-bus.models';

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
