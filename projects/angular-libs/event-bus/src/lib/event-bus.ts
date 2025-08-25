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
  private events = new Map<string, WritableSignal<any>>();
  private effects = new Map<string, EffectRef[]>();

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

    const unsubscribes = sources.map((s) =>
      this.addEffect(s.key as string, eff)
    );

    return () => {
      unsubscribes.forEach((u) => u());
    };
  }
}
