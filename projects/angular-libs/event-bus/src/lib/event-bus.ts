import {
  Injectable,
  WritableSignal,
  computed,
  effect,
  OnDestroy,
  EffectRef,
  signal,
  Signal,
} from '@angular/core';

// --- PUBLIC INTERFACES ---

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

interface HubEvent<TPayload> {
  key: string;
  payload: TPayload;
  timestamp: number;
}

type TransformedPayloads<TSources extends readonly CombineLatestSource[]> = {
  [K in keyof TSources]: TSources[K] extends CombineLatestSource<
    any,
    infer TTransformed
  >
    ? TTransformed
    : never;
};

/**
 * A generic, base EventBusService class.
 * It is NOT provided in the root directly. Instead, extend this class in your application.
 * @template TEventMap A map of event keys to payload types (e.g., { 'user:login': { id: number } }).
 */
@Injectable()
export class EventBusService<TEventMap extends {}> implements OnDestroy {
  private readonly NOT_EMITTED = Symbol('NOT_EMITTED');
  private events = new Map<string, WritableSignal<any>>();
  private effects: EffectRef[] = [];

  ngOnDestroy(): void {
    this.effects.forEach((eff) => eff.destroy());
    this.effects = [];
    this.events.clear();
  }

  private getSignal<TData = any>(key: string): WritableSignal<TData | symbol> {
    if (!this.events.has(key)) {
      this.events.set(key, signal(this.NOT_EMITTED));
    }
    return this.events.get(key)! as WritableSignal<TData | symbol>;
  }

  emit<K extends keyof TEventMap>(key: K, payload: TEventMap[K]): void {
    const event: HubEvent<TEventMap[K]> = {
      key: key as string,
      payload,
      timestamp: Date.now(),
    };
    this.getSignal<HubEvent<TEventMap[K]>>(key as string).set(event);
  }

  latest<K extends keyof TEventMap>(
    key: K
  ): HubEvent<TEventMap[K]> | undefined {
    const signalValue = this.getSignal<HubEvent<TEventMap[K]>>(key as string)();
    return signalValue === this.NOT_EMITTED
      ? undefined
      : (signalValue as HubEvent<TEventMap[K]>);
  }

  onToSignal<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options?: TransformOptions<TEventMap[K], TTransformed>
  ): Signal<TTransformed | undefined> {
    return computed(() => {
      const value = this.getSignal<HubEvent<TEventMap[K]>>(key as string)();
      if (value === this.NOT_EMITTED) {
        return undefined;
      }
      const hubEvent = value as HubEvent<TEventMap[K]>;
      return options?.transform
        ? options.transform(hubEvent.payload)
        : (hubEvent.payload as unknown as TTransformed);
    });
  }

  on<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>
  ): () => void {
    const eventSignal = this.onToSignal(key, { transform: options.transform });
    const eff = effect(() => {
      const payload = eventSignal();
      if (payload !== undefined) {
        const result = options.callback(payload);
        if (result instanceof Promise) {
          result.catch((error) =>
            console.error(`Error in callback for event ${String(key)}:`, error)
          );
        }
      }
    });
    this.effects.push(eff);
    return () => {
      eff.destroy();
      const index = this.effects.indexOf(eff);
      if (index > -1) {
        this.effects.splice(index, 1);
      }
    };
  }

  once<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>
  ): () => void {
    let unsubscribe: () => void;
    const oneTimeCallback = async (payload: TTransformed) => {
      if (unsubscribe) {
        unsubscribe();
      }
      try {
        await options.callback(payload);
      } catch (error) {
        console.error(
          `Error in once callback for event ${String(key)}:`,
          error
        );
      }
    };
    unsubscribe = this.on(key, {
      callback: oneTimeCallback,
      transform: options.transform,
    });
    return unsubscribe;
  }

  combineLatestToSignal<const TSources extends readonly CombineLatestSource[]>(
    sources: TSources
  ): Signal<TransformedPayloads<TSources> | undefined> {
    return computed(() => {
      const values = sources.map((s) => this.getSignal(s.key)());
      if (values.some((v) => v === this.NOT_EMITTED)) {
        return undefined;
      }
      const hubEvents = values as HubEvent<any>[];
      return hubEvents.map((hubEvent, i) => {
        const source = sources[i];
        return source.transform
          ? source.transform(hubEvent.payload)
          : hubEvent.payload;
      }) as TransformedPayloads<TSources>;
    });
  }

  combineLatest<const TSources extends readonly CombineLatestSource[]>(
    options: CombineLatestOptions<TSources>
  ): () => void {
    const { sources, callback } = options;
    const combinedSignal = this.combineLatestToSignal(sources);
    const eff = effect(() => {
      const payloads = combinedSignal();
      if (payloads !== undefined) {
        const result = callback(payloads);
        if (result instanceof Promise) {
          const keys = sources.map((s) => s.key).join(', ');
          result.catch((error) =>
            console.error(
              `Error in combineLatest callback for events ${keys}:`,
              error
            )
          );
        }
      }
    });
    this.effects.push(eff);
    return () => {
      eff.destroy();
      const index = this.effects.indexOf(eff);
      if (index > -1) {
        this.effects.splice(index, 1);
      }
    };
  }
}
