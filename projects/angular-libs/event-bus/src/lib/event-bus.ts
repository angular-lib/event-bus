import {
  Injectable,
  WritableSignal,
  computed,
  effect,
  OnDestroy,
  EffectRef,
  signal,
  Signal,
  inject,
  runInInjectionContext,
  EnvironmentInjector,
} from '@angular/core';
import {
  CombineLatestOptions,
  CombineLatestSource,
  BusEvent,
  SubscriptionOptions,
  TransformedPayloads,
  TransformOptions,
} from './event-bus.models';

/**
 * A generic, signal-based event bus service.
 * It is not provided in the root directly. Instead, extend this class in your application
 * and provide it there. This allows you to have a typed event bus.
 *
 * @example
 * ```typescript
 * // 1. Define your event map
 * interface AppEventMap {
 *   'user:login': { userId: string };
 *   'user:logout': void;
 * }
 *
 * // 2. Create a typed EventBusService
 * @Injectable({ providedIn: 'root' })
 * export class AppEventBusService extends EventBusService<AppEventMap> {}
 *
 * // 3. Use it in your components or services
 * export class MyComponent {
 *   constructor(private eventBus: AppEventBusService) {
 *     this.eventBus.on('user:login', {
 *       callback: (payload) => console.log('User logged in:', payload.userId),
 *     });
 *
 *     this.eventBus.emit('user:login', { userId: '123' });
 *   }
 * }
 * ```
 *
 * @template TEventMap A map of event keys to payload types (e.g., `{ 'user:login': { userId: string } }`).
 */
@Injectable()
export class EventBusService<TEventMap extends {}> implements OnDestroy {
  private readonly NOT_EMITTED = Symbol('NOT_EMITTED');
  // capture the injector at construction time so we can create effects
  // in the library's injection context even when `on` is called from
  // user code outside an injection context.
  private injector: EnvironmentInjector;
  private events = new Map<string, WritableSignal<any>>();
  private effects = new Map<string, EffectRef[]>();

  constructor(injector?: EnvironmentInjector) {
    this.injector =
      injector ?? inject(EnvironmentInjector, { optional: true })!;
    if (!this.injector) {
      throw new Error('EventBusService requires an Angular injection context.');
    }
  }

  ngOnDestroy(): void {
    this.clearSubscriptions();
    this.events.clear();
  }

  /**
   * Clears all subscriptions from the event bus.
   */
  clearSubscriptions(): void {
    this.effects.forEach((effects) => effects.forEach((eff) => eff.destroy()));
    this.effects.clear();
  }

  private addEffect(key: string, effect: EffectRef): () => void {
    if (!this.effects.has(key)) {
      this.effects.set(key, []);
    }
    this.effects.get(key)!.push(effect);
    return () => {
      effect.destroy();
      const keyEffects = this.effects.get(key);
      if (keyEffects) {
        const index = keyEffects.indexOf(effect);
        if (index > -1) {
          keyEffects.splice(index, 1);
        }
        if (keyEffects.length === 0) {
          this.effects.delete(key);
        }
      }
    };
  }

  private getSignal<TData = any>(key: string): WritableSignal<TData | symbol> {
    if (!this.events.has(key)) {
      this.events.set(key, signal(this.NOT_EMITTED));
    }
    return this.events.get(key)! as WritableSignal<TData | symbol>;
  }

  /**
   * Emits an event.
   */
  emit<K extends keyof TEventMap>(key: K, payload: TEventMap[K]): void {
    const event: BusEvent<TEventMap[K]> = {
      key: key as string,
      payload,
      timestamp: Date.now(),
    };
    this.getSignal<BusEvent<TEventMap[K]>>(key as string).set(event);
  }

  /**
   * Unsubscribes from all subscriptions for a given event.
   */
  unsubscribe<K extends keyof TEventMap>(key: K): void {
    const keyEffects = this.effects.get(key as string);
    if (keyEffects) {
      keyEffects.forEach((eff) => eff.destroy());
      this.effects.delete(key as string);
    }
  }

  /**
   * Gets the latest event for a given key.
   */
  latest<K extends keyof TEventMap>(
    key: K
  ): BusEvent<TEventMap[K]> | undefined {
    const signalValue = this.getSignal<BusEvent<TEventMap[K]>>(key as string)();
    return signalValue === this.NOT_EMITTED
      ? undefined
      : (signalValue as BusEvent<TEventMap[K]>);
  }

  /**  Creates a signal that emits the payload of an event. */
  onToSignal<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options?: TransformOptions<TEventMap[K], TTransformed>
  ): Signal<TTransformed | undefined> {
    return computed(() => {
      const value = this.getSignal<BusEvent<TEventMap[K]>>(key as string)();
      if (value === this.NOT_EMITTED) {
        return undefined;
      }
      const hubEvent = value as BusEvent<TEventMap[K]>;
      return options?.transform
        ? options.transform(hubEvent.payload)
        : (hubEvent.payload as unknown as TTransformed);
    });
  }

  /** Subscribes to an event.*/
  on<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>
  ): () => void {
    const { callback, transform } = options;
    const create = () =>
      effect(() => {
        // Read the raw BusEvent signal so we can detect emissions even when
        // the payload is `undefined`.
        const raw = this.getSignal<BusEvent<TEventMap[K]>>(key as string)();
        if (raw === this.NOT_EMITTED) return;

        const busEvent = raw as BusEvent<TEventMap[K]>;
        const transformedPayload = transform
          ? transform(busEvent.payload as TEventMap[K])
          : (busEvent.payload as unknown as TTransformed);

        const eventToDispatch: BusEvent<TTransformed> = {
          key: busEvent.key,
          timestamp: busEvent.timestamp,
          payload: transformedPayload,
        };

        try {
          const result = callback(eventToDispatch);
          Promise.resolve(result).catch((error) =>
            console.error(`Error in callback for event ${String(key)}:`, error)
          );
        } catch (error) {
          console.error(`Error in callback for event ${String(key)}:`, error);
        }
      });

    const eff = runInInjectionContext(this.injector, create);
    return this.addEffect(key as string, eff);
  }

  /**
   * Subscribes to an event for one emission.
   */
  once<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>
  ): () => void {
    let unsubscribe: () => void;
    const oneTimeCallback = async (event: BusEvent<TTransformed>) => {
      if (unsubscribe) {
        unsubscribe();
      }
      try {
        await options.callback(event);
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
    } as any);
    return unsubscribe;
  }

  /**
   * Combines the latest values of multiple events into a signal.
   */
  combineLatestToSignal<const TSources extends readonly CombineLatestSource[]>(
    sources: TSources
  ): Signal<TransformedPayloads<TSources> | undefined> {
    return computed(() => {
      const values = sources.map((s) => this.getSignal(s.key)());
      if (values.some((v) => v === this.NOT_EMITTED)) {
        return undefined;
      }
      const hubEvents = values as BusEvent<any>[];
      return hubEvents.map((hubEvent, i) => {
        const source = sources[i];
        return source.transform
          ? source.transform(hubEvent.payload)
          : hubEvent.payload;
      }) as TransformedPayloads<TSources>;
    });
  }

  /**
   * Subscribes to the combination of the latest values of multiple events.
   */
  combineLatest<const TSources extends readonly CombineLatestSource[]>(
    options: CombineLatestOptions<TSources>
  ): () => void {
    const { sources, callback } = options;
    const combinedSignal = this.combineLatestToSignal(sources);
    const create = () =>
      effect(() => {
        const payloads = combinedSignal();
        if (payloads !== undefined) {
          // Build BusEvent<TTransformed>[] matching sources order
          const events = payloads.map((payload, i) => ({
            key: sources[i].key,
            timestamp: Date.now(),
            payload,
          })) as any;

          const result = callback(events);
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

    const eff = runInInjectionContext(this.injector, create);

    // register the effect under a single composite key so destroying is done once
    const compositeKey = `__combine__:${sources
      .map((s) => s.key)
      .join('|')}:${Date.now()}:${Math.random()}`;
    this.addEffect(compositeKey, eff);

    return () => {
      const remove = this.effects.get(compositeKey);
      if (remove) {
        this.effects.get(compositeKey)!.forEach((e) => e.destroy());
        this.effects.delete(compositeKey);
      }
    };
  }
}
