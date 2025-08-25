# Event Bus

A simple, signal-based event bus for Angular.

## Features

- ✅ **Strongly Typed**: Enjoy full type-safety for your events out of the box.
- 🚀 **Signal-Based**: Built on top of Angular Signals for a modern, reactive architecture.
- 📡 **Flexible Subscriptions**: Use `on` for callback-based subscriptions or `onToSignal` to directly integrate with the signal ecosystem.
- 🔄 **Event Transformation**: Transform events with ease using `transform`.
- 🧹 **Automatic Cleanup**: Subscriptions are automatically cleaned up when the service is destroyed.

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
  "user:logout": { userId: string };
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

- **`emit(key, payload)`**: Emits an event with a given key and payload.
- **`on(key, options)`**: Subscribes to an event. Returns a function to unsubscribe.
- **`onToSignal(key, options)`**: Creates a signal that emits the payload of an event.
- **`latest(key)`**: Gets the latest event for a given key, including metadata.
- **`combineLatest(keys, options)`**: Creates a signal that emits an array of the latest values of multiple events.
- **`clearSubscriptions()`**: Clears all subscriptions from the event bus.

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

  // 1. Create signals from events
  private userLoginSignal = this.eventBus.onToSignal("user:login");

  // 2. Use `computed` for derived state
  welcomeMessage = computed(() => {
    const loginEvent = this.userLoginSignal();
    return loginEvent ? `Welcome, ${loginEvent.payload.userId}!` : "Please log in.";
  });

  constructor(private eventBus: AppEventBusService) {
    // 3. Use `once` for one-time side-effects that don't need cleanup
    this.eventBus.once("user:login", {
      callback: (payload) => console.log("User logged in for the first time:", payload.userId),
    });

    // 4. Use `on` for continuous side-effects and remember to cleanup
    this.cartSubscription = this.eventBus.on("cart:item-added", {
      callback: (payload) => {
        console.log("Item added to cart:", payload);
        const lastLoginEvent = this.eventBus.latest("user:login");
        if (lastLoginEvent) {
          console.log(`User ${lastLoginEvent.payload.userId} was logged in when item was added.`);
        }
      },
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
    this.cartSubscription();
  }
}
```
