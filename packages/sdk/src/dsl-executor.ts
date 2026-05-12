import type { Step } from '@web-companion/spec';
import { waitForTarget } from './target-resolver.js';

export interface StepContext {
  step: Step;
  target: Element;
  params: Record<string, unknown>;
  index: number;
}

export interface DslExecutorOptions {
  onBeforeStep?: (ctx: StepContext) => void | Promise<void>;
  onAfterStep?: (ctx: StepContext) => void;
}

const NON_WAIT_DEFAULT_TIMEOUT = 1500;
const WAIT_FOR_DEFAULT_TIMEOUT = 3000;

export async function executeSteps(
  steps: Step[],
  params: Record<string, unknown>,
  options: DslExecutorOptions = {},
): Promise<void> {
  for (let index = 0; index < steps.length; index++) {
    const raw = steps[index];
    if (!raw) continue;
    const step = interpolateStep(raw, params);
    const timeoutMs =
      step.type === 'wait_for'
        ? (step.timeoutMs ?? WAIT_FOR_DEFAULT_TIMEOUT)
        : NON_WAIT_DEFAULT_TIMEOUT;
    const resolved = await waitForTarget(step.target, { timeoutMs });

    await options.onBeforeStep?.({
      step,
      target: resolved.element,
      params,
      index,
    });
    await executeOneStep(step, resolved.element);
    options.onAfterStep?.({
      step,
      target: resolved.element,
      params,
      index,
    });
  }
}

function interpolateStep(step: Step, params: Record<string, unknown>): Step {
  const target = interpolateString(step.target, params);
  if (step.type === 'fill' || step.type === 'select') {
    return { ...step, target, value: interpolateString(step.value, params) };
  }
  return { ...step, target };
}

function interpolateString(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined || v === null) return `{${key}}`;
    return String(v);
  });
}

async function executeOneStep(step: Step, element: Element): Promise<void> {
  switch (step.type) {
    case 'click': {
      element.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, view: window }),
      );
      return;
    }
    case 'fill': {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement)
      ) {
        throw new Error(
          `fill step expects an <input> or <textarea>, got <${element.tagName.toLowerCase()}>`,
        );
      }
      setNativeValue(element, step.value);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, data: step.value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'select': {
      if (!(element instanceof HTMLSelectElement)) {
        throw new Error(
          `select step expects a <select>, got <${element.tagName.toLowerCase()}>`,
        );
      }
      element.value = step.value;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'check': {
      if (
        !(element instanceof HTMLInputElement) ||
        (element.type !== 'checkbox' && element.type !== 'radio')
      ) {
        throw new Error(
          `check step expects a checkbox/radio <input>, got ${element.tagName.toLowerCase()}`,
        );
      }
      element.checked = step.checked ?? !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'wait_for':
      return;
  }
}

/**
 * React (and Vue) keep a private value tracker on controlled inputs. Plain
 * `element.value = x` bypasses it — the framework's onChange won't fire.
 * Calling the prototype's value setter triggers the tracker, then dispatching
 * an `input` event tells the framework to re-render.
 */
function setNativeValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto = Object.getPrototypeOf(element);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
}
