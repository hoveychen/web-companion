function ensure() {
  if (!window.__cart) {
    throw new Error(
      'Cart bridge not ready — the React app must mount before handlers run.',
    );
  }
  return window.__cart;
}

export function addToCart(params) {
  return ensure().addToCart(params);
}

export function removeFromCart(params) {
  return ensure().removeFromCart(params);
}

export function checkout() {
  return ensure().checkout();
}

export function getCart() {
  return ensure().getCart();
}

export function getMenu() {
  return ensure().getMenu();
}
