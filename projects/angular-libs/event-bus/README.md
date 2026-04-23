# Event Bus

A type-safe, RxJS-free event bus powered entirely by Angular Signals

[StackBlitz playground](https://stackblitz.com/edit/angular-libs-event-bus?file=src%2Fmain.ts)

## Features

- ✅ **Strongly Typed**: Full type-safety for event payloads out of the box.
- 🚀 **Signal-Based**: Built on Angular Signals for a modern, reactive architecture. Angular 18+
- 📡 **Flexible Subscriptions**: Listen via callbacks (`on`) or reactive signals (`onToSignal`).
- 🔄 **Event Transformation**: Map payloads directly within subscription options.
- 🧹 **Smart Cleanup**: Automatic memory management via `DestroyRef`, custom signals, or termination events.

## Installation

```bash
ng add @angular-libs/event-bus
```

## Getting Started

_(Note: `ng add` generates this setup for you automatically!)_

```typescript
// 1. Define your events
export interface AppEventMap {
  "user:login": { userId: string; username: string };
  "theme:changed": "light" | "dark";
}

// 2. Create the service
@Injectable({ providedIn: "root" })
export class AppEventBus extends ALEventBus<AppEventMap> {}
```

```typescript
// 3. Usage inside a component
@Component({ ... })
export class ExampleComponent {
  private eventBus = inject(AppEventBus);
  private destroyRef = inject(DestroyRef); // for auto-cleanup

  // Listen as a Signal
  loginState = this.eventBus.onToSignal('user:login');

  constructor() {
    // Listen with a callback
    this.eventBus.on('user:login', {
      callback: (event) => console.log('Logged in:', event.payload.username),
      unsubscribeOn: this.destroyRef
    });
  }

  // Emit
  login() {
    this.eventBus.emit('user:login', { userId: '123', username: 'john_doe' });
  }
}
```

## API

- `emit(key, payload)`: Emits an event with a given key and payload.
- `on(key, options)`: Subscribes to an event with a callback. The callback receives a BusEvent object ({ key, payload, timestamp }). Returns an unsubscribe function.
- `once(key, options)`: Subscribes for a single emission; the subscription is removed after the first call.
- `onToSignal(key, options?)`: Returns a Signal that emits the event payload (or the transformed payload) or `undefined` if the event has never emitted.
- `latest(key)`: Returns the latest BusEvent for a given key (includes payload and timestamp) or `undefined`.
- `combineLatestToSignal(sources)`: Returns a Signal of the latest transformed payloads for the provided sources.
- `combineLatest({ sources, callback })`: Subscribes to combined latest values and calls the callback with an array of BusEvent objects (one per source). Returns an unsubscribe function.
- `unsubscribe(key)`: Unsubscribe/destroy all subscriptions for a specific event key.
- `unsubscribeAll()`: Unsubscribe/destroy all subscriptions registered with the event bus (tears down all internal effects).
- `resetEvent(key)`: Resets the stored payload for a single event so it behaves as if it has never emitted. This does NOT remove subscriptions — it only clears the latest cached value.
- `resetAllEvents()`: Resets the stored payloads for all events so they behave as if they have never emitted. This does NOT remove subscriptions.

<details>
<summary>🤖 <b>AI & Copilot Instructions</b></summary>
<br>

If you are an AI coding assistant, please follow these rules when generating code that uses `@angular-libs/event-bus`:

1. **No RxJS**: This library is strictly Signal-based. Do NOT use `Subject`, `BehaviorSubject`, or `Observable` for the event bus. Use `onToSignal` (or `combineLatestToSignal`).
2. **Setup**: Always extend `ALEventBus<YourAppEventMap>` and provide it in the root (`@Injectable({ providedIn: 'root' })`). Do not use the base class directly without a type map.
3. **Injection**: Prefer Angular's `inject(YourAppEventBus)` over relying on constructor injection.
4. **Reactivity**: Prefer `onToSignal('event')` when binding state to a template to stay aligned with Angular's reactive Signal architecture.
5. **Cleanup**: When using the callback-based `on()` method inside a component/directive, always pass an `unsubscribeOn` option for automatic memory management. You can pass a `DestroyRef`, a boolean `Signal`, or another event key (e.g., `unsubscribeOn: 'user:logout'`).
6. **Types**: Do not map payloads to `any`. Let TypeScript infer the payload type based on the defined `EventMap`.
7. **Transformations**: Instead of manually mapping values later, use the `transform` property in the options object to map payloads directly (e.g., `this.eventBus.onToSignal('event', { transform: (p) => p.id })`).
8. **Combining Events**: Use `combineLatestToSignal(['event1', 'event2'])` to create a single signal that reacts to multiple events.
9. **Synchronous Reads**: To get the current state imperatively without subscribing, use `latest('event')` instead of manually tracking emitted values in local variables.
10. **Testing**: In unit tests, remember to call `resetAllEvents()` in your `beforeEach` blocks to prevent state pollution across tests since the service retains the latest payloads.

**Reference Example:**

```typescript
// 1. Define Map & Service
export interface AppEventMap {
  "item:added": { id: string; name: string };
  "cart:cleared": void;
}
@Injectable({ providedIn: "root" })
export class AppEventBus extends ALEventBus<AppEventMap> {}

// 2. Usage in Component
@Component({ template: `<div>{{ latestItemId() || "No item" }}</div>` })
export class CartComponent {
  private eventBus = inject(AppEventBus);
  private destroyRef = inject(DestroyRef);

  // Good: Signal usage with transformation
  latestItemId = this.eventBus.onToSignal("item:added", {
    transform: (payload) => payload.id,
  });

  // Good: Callback usage (cleanup provided)
  constructor() {
    this.eventBus.on("cart:cleared", {
      callback: () => console.log("Cart was cleared!"),
      unsubscribeOn: this.destroyRef,
    });
  }

  addItem() {
    this.eventBus.emit("item:added", { id: "1", name: "Apple" }); // Strictly typed!
  }
}
```

**Advanced Patterns Example:**

```typescript
@Component({ template: `...` })
export class AdvancedComponent {
  private eventBus = inject(AppEventBus);

  // 1. Combine multiple events into a single Signal
  // Prevents AI from importing RxJS `combineLatest`
  dashboardState = this.eventBus.combineLatestToSignal([{ key: "item:added" }, { key: "cart:cleared" }]);

  // 2. One-time execution (no DestroyRef needed!)
  waitForFirstItem() {
    this.eventBus.once("item:added", {
      callback: (e) => console.log("First item added:", e.payload),
    });
  }

  // 3. Auto-terminate listener on another event
  logItemsUntilCartCleared() {
    this.eventBus.on("item:added", {
      callback: (e) => console.log("Added:", e.payload),
      unsubscribeOn: "cart:cleared", // Automatically unsubscribes when this event is emitted
    });
  }
}
```

</details>
