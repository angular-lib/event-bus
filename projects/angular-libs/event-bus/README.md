# Event Bus

[StackBlitz playground](https://stackblitz.com/edit/angular-libs-event-bus?file=src%2Fmain.ts)

A simple, signal-based event bus for Angular.

## Features

- ✅ **Strongly Typed**: Enjoy full type-safety for your events out of the box.
- 🚀 **Signal-Based**: Built on top of Angular Signals for a modern, reactive architecture.
- 📡 **Flexible Subscriptions**: Use `on` for callback-based subscriptions or `onToSignal` to directly integrate with the signal ecosystem.
- 🔄 **Event Transformation**: Pass a `transform` function in subscription/options (for `on`, `once`, `onToSignal`, and combine sources) to map payloads.
- 🧹 **Automatic Cleanup**: Subscriptions registered by the service are automatically destroyed when the service is torn down (ngOnDestroy). Use `clearSubscriptions()` or `unsubscribe(key)` for manual cleanup if needed.
- 🧹 **Automatic Cleanup**: Subscriptions registered by the service are automatically destroyed when the service is torn down (ngOnDestroy). Use `unsubscribeAll()` or `unsubscribe(key)` for manual cleanup if needed.

## Installation

```bash
ng add @angular-libs/event-bus
```

## Getting Started

The `ng add` command will generate an `AppEventBusService` and an `AppEventMap` for you.

**1. Define your events in `app/event-bus/event-bus.models.ts`:**

```typescript
export interface AppEventMap {
  "user:login": { userId: string };
  "user:logout": { userId: string } | void;
  "cart:item-added": { itemId: string; quantity: number };
}
```

**2. Use the `AppEventBusService` in your components and services:**

```typescript
import { Component } from "@angular/core";
import { AppEventBusService } from "../event-bus/app-event-bus.service";

@Component({
  selector: "app-login",
  template: `<button (click)="login()">Login</button>`,
})
export class LoginComponent {
  constructor(private eventBus: AppEventBusService) {}

  login() {
    this.eventBus.emit("user:login", { userId: "123" });
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

### Notes on transform

There is no standalone `transform(...)` method. Instead, pass a `transform` function in the options for `on`, `once`, `onToSignal`, or as part of each source object passed to `combineLatestToSignal` / `combineLatest`. The transform function maps the raw payload to a derived value.

### Combined Example

Here's a more complete example demonstrating how to use the different API methods together in a component.

```typescript
import { Component, OnDestroy, computed } from "@angular/core";
import { AppEventBusService } from "../event-bus/app-event-bus.service";

@Component({
  selector: "app-user-status",
  template: `
    <button (click)="login()">Login</button>
    <button (click)="logout()">Logout</button>
    <button (click)="addToCart()">Add to Cart</button>
    <p>{{ welcomeMessage() }}</p>
    <p>{{ cartStatus() }}</p>
  `,
})
export class UserStatusComponent implements OnDestroy {
  private cartSubscription: () => void;

  // 1. Create signals from events — note the signal returns the payload (or undefined)
  private userLoginSignal = this.eventBus.onToSignal("user:login");

  // 2. Use `computed` for derived state
  welcomeMessage = computed(() => {
    const login = this.userLoginSignal();
    return login ? `Welcome, ${login.userId}!` : "Please log in.";
  });

  constructor(private eventBus: AppEventBusService) {
    // 3. Use `once` for one-time side-effects — callback receives a BusEvent
    this.eventBus.once("user:login", {
      callback: (event) => console.log("User logged in for the first time:", event.payload.userId),
    });

    // 4. Use `on` for continuous side-effects and remember to cleanup
    this.cartSubscription = this.eventBus.on("cart:item-added", {
      callback: (event) => {
        console.log("Item added to cart:", event.payload);
        const lastLoginEvent = this.eventBus.latest("user:login");
        if (lastLoginEvent) {
          console.log(`User ${lastLoginEvent.payload.userId} was logged in when item was added.`);
        }
      },
      // unsubscribe on `user:logout` event
      unsubscribeOn: "user:logout",
    });
  }

  // 5. Emit events
  login() {
    this.eventBus.emit("user:login", { userId: "42" });
  }

  logout() {
    this.eventBus.emit("user:logout", { userId: "42" });
  }

  addToCart() {
    this.eventBus.emit("cart:item-added", { itemId: "abc", quantity: 1 });
  }

  // 6. Clean up subscriptions
  ngOnDestroy() {
    // manually unsubscribe the cart handler.
    this.cartSubscription();
    // Or globally unsubscribe => this.eventBus.unsubscribe('cart:item-added');
    // (other subscriptions created via the service will be destroyed automatically when the service is torn down)
  }
}
```
