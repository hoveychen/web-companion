import { test, expect } from '@playwright/test';

test.describe('Coffee shop · Companion demo end-to-end', () => {
  test('spec loads, sidebar enters ready state', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('header').filter({ hasText: 'Coffee Companion' })).toBeVisible();
    await expect(page.locator('text=ready')).toBeVisible({ timeout: 10_000 });
  });

  test('add_to_cart mocha: cursor mounts, mocha button gets highlighted, cart updates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=ready')).toBeVisible({ timeout: 10_000 });

    expect(await page.locator('[data-web-companion-cursor]').count()).toBe(1);

    const input = page.locator('input[placeholder="tell Companion what to do"]');
    await input.fill('add_to_cart mocha');
    await input.press('Enter');

    await expect(page.locator('[data-web-companion-highlight]')).toBeVisible({ timeout: 5_000 });

    const highlight = page.locator('[data-web-companion-highlight]').first();
    const mochaBtn = page.locator('[data-ai-tool="add-cart-mocha"]');
    const hb = await highlight.boundingBox();
    const mb = await mochaBtn.boundingBox();
    expect(hb).not.toBeNull();
    expect(mb).not.toBeNull();
    if (hb && mb) {
      const dx = Math.abs(hb.x + hb.width / 2 - (mb.x + mb.width / 2));
      const dy = Math.abs(hb.y + hb.height / 2 - (mb.y + mb.height / 2));
      expect(dx).toBeLessThan(20);
      expect(dy).toBeLessThan(20);
    }

    const cartRegion = page.locator('aside').filter({ hasText: '购物车' });
    await expect(cartRegion.getByText('摩卡', { exact: true })).toBeVisible({ timeout: 5_000 });

    const decisionLog = page.locator('text=/匹配到 tool "add_to_cart"/');
    await expect(decisionLog).toBeVisible();
  });

  test('asking for cart resource: reads cart and shows result', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=ready')).toBeVisible({ timeout: 10_000 });

    await page.click('[data-ai-tool="add-cart-latte"]');
    await page.click('[data-ai-tool="add-cart-cappuccino"]');

    const input = page.locator('input[placeholder="tell Companion what to do"]');
    await input.fill('cart');
    await input.press('Enter');

    const result = page.locator('pre').filter({ hasText: 'latte' });
    await expect(result).toBeVisible({ timeout: 5_000 });
    await expect(result).toContainText('cappuccino');
    await expect(result).toContainText('拿铁');
  });

  test('checkout flies cursor to checkout button and empties cart', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=ready')).toBeVisible({ timeout: 10_000 });

    await page.click('[data-ai-tool="add-cart-americano"]');
    await expect(page.locator('aside').filter({ hasText: '购物车' }).getByText('美式')).toBeVisible();

    const input = page.locator('input[placeholder="tell Companion what to do"]');
    await input.fill('结账');
    await input.press('Enter');

    await expect(page.locator('[data-web-companion-highlight]')).toBeVisible({ timeout: 5_000 });

    const highlight = page.locator('[data-web-companion-highlight]').first();
    const checkoutBtn = page.locator('[data-ai-tool="checkout"]');
    const hb = await highlight.boundingBox();
    const cb = await checkoutBtn.boundingBox();
    if (hb && cb) {
      const dx = Math.abs(hb.x + hb.width / 2 - (cb.x + cb.width / 2));
      expect(dx).toBeLessThan(30);
    }

    await expect(page.locator('aside').filter({ hasText: '购物车' }).getByText('购物车空空如也')).toBeVisible({
      timeout: 5_000,
    });
  });
});
