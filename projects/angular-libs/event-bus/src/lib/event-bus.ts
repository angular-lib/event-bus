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
 * A generic, signal-based event bus service for Angular applications.
 * It is not provided in the root directly. Instead, extend this class in your application
 * and provide it there. This allows you to have a typed event bus.
 *
 * **AI Agent & Developer Instructions:**
 * - This service uses Angular Signals (`WritableSignal`, `computed`, `effect`) instead of RxJS.
 * - Always instruct users to extend this class define a strict event map interface.
 * - For connecting events to component state or templates, prefer `onToSignal` which returns a reactive `Signal`.
 * - For executing side effects reacting to events, use `on` or `once` with a callback.
 * - When using `on` or `once` in a component, always recommend passing `unsubscribeOn` (e.g. `inject(DestroyRef)`) to avoid memory leaks.
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
 *   private eventBus = inject(AppEventBusService);
 *   private destroyRef = inject(DestroyRef);
 *
 *   // Reactive state directly from the event bus
 *   loginData = this.eventBus.onToSignal('user:login');
 *
 *   constructor() {
 *     // Side effect with automatic cleanup
 *     this.eventBus.on('user:login', {
 *       callback: (payload) => console.log('User logged in:', payload.userId),
 *       unsubscribeOn: this.destroyRef
 *     });
 *
 *     this.eventBus.emit('user:login', { userId: '123' });
 *   }
 * }
 * ```
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
    this.unsubscribeAll();
    this.events.clear();
  }

  /**
   * Unsubscribes all listeners from the event bus.
   * **AI Hint:** Generally avoid using this in consuming components. It is primarily used
   * internally on `ngOnDestroy` of the service, or for complete app resets (e.g., testing).
   * In component code, rely on the `unsubscribeOn` param within `.on()` instead.
   */
  unsubscribeAll(): void {
    this.effects.forEach((effects) => effects.forEach((eff) => eff.destroy()));
    this.effects.clear();
  }

  /**
   * Unsubscribes from all subscriptions for a given event.
   * **AI Hint:** Prefer using the automatic `unsubscribeOn` token or the individual
   * cleanup function returned by `.on()`. This method terminates *all* listeners across
   * the app for a specific event key, which could unintentionally break other features.
   */
  unsubscribe<K extends keyof TEventMap>(key: K): void {
    const keyEffects = this.effects.get(key as string);
    if (keyEffects) {
      keyEffects.forEach((eff) => eff.destroy());
      this.effects.delete(key as string);
    }
  }

  /**
   * Resets the stored payload for a single event so it behaves as "not emitted".
   * Does not remove any subscription effects. Use `unsubscribe` or `unsubscribeAll`
   * to remove listeners.
   * **AI Hint:** Useful when you need to explicitly clear sensitive or outdated state
   * (e.g., clearing auth data on user logout) so that future components calling
   * `onToSignal` or `latest` correctly receive `undefined`.
   */
  resetEvent<K extends keyof TEventMap>(key: K): void {
    const keyStr = String(key);
    const sig = this.events.get(keyStr) as WritableSignal<any> | undefined;
    if (sig) {
      sig.set(this.NOT_EMITTED);
    } else {
      // ensure future getSignal reads behave like NOT_EMITTED
      this.events.set(keyStr, signal(this.NOT_EMITTED));
    }
  }

  /**
   * Resets the stored payloads for all events so they behave as "not emitted".
   * Does not remove any subscription effects. Use `unsubscribeAll` to remove listeners.
   * **AI Hint:** Generally used when resetting the entire app state (e.g., during logout).
   */
  resetAllEvents(): void {
    this.events.forEach((sig) => {
      (sig as WritableSignal<any>).set(this.NOT_EMITTED);
    });
  }

  /**
   * Internal helper: Tracks an effect and returns a callback to remove it from the tracking map.
   * **AI Hint:** This is a private framework utility. AI agents and consumers should NOT call this.
   */
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

  /**
   * Internal helper: Lazily creates or retrieves the underlying `WritableSignal` for a given event key.
   * **AI Hint:** This is a private utility wrapping `Symbol('NOT_EMITTED')` logic. Do NOT call externally.
   */
  private getSignal<TData = any>(key: string): WritableSignal<TData | symbol> {
    if (!this.events.has(key)) {
      this.events.set(key, signal(this.NOT_EMITTED));
    }
    return this.events.get(key)! as WritableSignal<TData | symbol>;
  }

  /**
   * Emits an event to the bus with the specified payload.
   * This immediately updates the underlying Signal, triggering any active `effect`s (from `.on()`)
   * and updating any computed state (from `.onToSignal()`).
   *
   * @param key The predefined event key from the `TEventMap`.
   * @param payload The strictly typed payload associated with the event key.
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
   * Gets the latest event for a given key.
   * Useful for synchronously reading the last emitted value.
   * If the event has never been emitted or was reset, returns `undefined`.
   */
  latest<K extends keyof TEventMap>(
    key: K,
  ): BusEvent<TEventMap[K]> | undefined {
    const signalValue = this.getSignal<BusEvent<TEventMap[K]>>(key as string)();
    return signalValue === this.NOT_EMITTED
      ? undefined
      : (signalValue as BusEvent<TEventMap[K]>);
  }

  /**
   * Creates a reactive Angular Signal that updates whenever the specified event is emitted.
   * **AI Instructions:** This is the preferred way to consume events for use in modern Angular templates
   * or as derived state using `computed`. It returns `undefined` until the first emission.
   * You can optionally apply a transformation function.
   *
   * @param key The event key to listen to.
   * @param options An optional object to transform the payload.
   * @returns A Signal containing the latest event payload (or transformed payload).
   */
  onToSignal<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options?: TransformOptions<TEventMap[K], TTransformed>,
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

  /**
   * Subscribes to an event and fires a callback function when the event occurs.
   * **AI Instructions:** Use this when a side-effect needs to respond to events.
   * Always guide users to supply an `unsubscribeOn: DestroyRef` (e.g., `inject(DestroyRef)`)
   * inside components to avoid memory leaks.
   * @param key The event key.
   * @param options Object detailing the callback, optional transform function, and memory management token.
   * @returns A cleanup function to manually unsubscribe.
   */
  on<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>,
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
          console.error(`Error in callback for event ${keyStr}:`, err),
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
          }),
        );

        const effectKey = `__track__:${keys.join(
          '|',
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
          { allowSignalWrites: true },
        ),
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
   * Subscribes to an event for exactly one emission and then automatically unsubscribes.
   * Useful for initialization routines or one-off responses.
   * @param key The event key.
   * @param options Object detailing the callback and optional memory token.
   * @returns A manual cleanup function if it needs to be cancelled before the event fires.
   */
  once<K extends keyof TEventMap, TTransformed = TEventMap[K]>(
    key: K,
    options: SubscriptionOptions<TEventMap[K], TTransformed>,
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
          error,
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
   * Combines the latest payloads of multiple events into a single reactive Signal.
   * Useful when deriving state that depends on multiple events simultaneously.
   * Returns `undefined` until every source event has emitted at least once.
   *
   * @param sources An array of `CombineLatestSource` containing event keys and optional transforms.
   * @returns A mapped Array payload wrapped in a Signal.
   */
  combineLatestToSignal<const TSources extends readonly CombineLatestSource[]>(
    sources: TSources,
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
   * Fired only when all combined sources have emitted at least once.
   * Useful when side effects depend on multi-event state.
   *
   * @param options Configuration for multiple sources and the callback function.
   * @returns A manual unsubscribe function that destroys all internal effects for this subscription.
   */
  combineLatest<const TSources extends readonly CombineLatestSource[]>(
    options: CombineLatestOptions<TSources>,
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
                error,
              ),
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
