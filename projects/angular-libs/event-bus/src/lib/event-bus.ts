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
  DestroyRef,
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
    const keyStr = String(key);

    // small dispatcher that runs the callback with transformed payload and logs errors
    const dispatch = (busEvent: BusEvent<TEventMap[K]>) => {
      const { key, timestamp, payload } = busEvent;
      const transformed = transform
        ? transform(payload as TEventMap[K])
        : (payload as unknown as TTransformed);

      const evt = { key, timestamp, payload: transformed };

      try {
        const res = callback(evt);
        Promise.resolve(res).catch((err) =>
          console.error(`Error in callback for event ${keyStr}:`, err)
        );
      } catch (err) {
        console.error(`Error in callback for event ${keyStr}:`, err);
      }
    };

    // main effect factory
    const createMainEffect = () =>
      effect(() => {
        const raw = this.getSignal<BusEvent<TEventMap[K]>>(keyStr)();
        if (raw === this.NOT_EMITTED) return;
        dispatch(raw as BusEvent<TEventMap[K]>);
      });

    let removeMain: (() => void) | null = null;
    let removeTracker: (() => void) | null = null;
    let destroyedBeforeCreate = false;

    const removeBoth = () => {
      removeMain?.();
      removeTracker?.();
    };

    // lightweight tracker factory for unsubscribeOn tokens
    const makeTracker = (token: any) => {
      if (!token) return;

      // DestroyRef-like
      if (typeof token.onDestroy === 'function') {
        (token as DestroyRef).onDestroy(removeBoth);
        return;
      }

      // event key or keys
      if (typeof token === 'string' || Array.isArray(token)) {
        const keys = Array.isArray(token) ? token : [token];
        const initial = keys.map((k) => this.getSignal(k)());

        const eff = runInInjectionContext(this.injector, () =>
          effect(() => {
            for (let i = 0; i < keys.length; i++) {
              if (
                initial[i] === this.NOT_EMITTED &&
                this.getSignal(keys[i])() !== this.NOT_EMITTED
              ) {
                removeBoth();
                break;
              }
            }
          })
        );

        const effectKey = `__track__:${keys.join(
          '|'
        )}:${keyStr}:${Date.now()}:${Math.random()}`;
        removeTracker = this.addEffect(effectKey, eff);
        return;
      }

      // assume Signal-like
      const eff = runInInjectionContext(this.injector, () =>
        effect(
          () => {
            if ((token as Signal<any>)()) removeBoth();
          },
          { allowSignalWrites: true }
        )
      );
      const effectKey = `__track__:signal:${keyStr}:${Date.now()}:${Math.random()}`;
      removeTracker = this.addEffect(effectKey, eff);
    };

    // create main effect in the captured injector (outside caller reactive context)
    Promise.resolve().then(() => {
      const effRef = runInInjectionContext(this.injector, createMainEffect);
      removeMain = this.addEffect(keyStr, effRef);

      if (destroyedBeforeCreate) {
        // caller unsubscribed synchronously before effect was created
        removeMain();
        removeMain = null;
        return;
      }

      if (options.unsubscribeOn) {
        makeTracker(options.unsubscribeOn as any);
      }
    });

    // synchronous unsubscribe
    const unsubscribe = () => {
      if (removeMain) {
        removeMain();
      } else {
        destroyedBeforeCreate = true;
      }

      if (removeTracker) {
        removeTracker();
        removeTracker = null;
      }
    };

    return unsubscribe;
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
