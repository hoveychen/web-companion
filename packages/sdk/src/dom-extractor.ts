import type { ExtractConfig, FieldExtract } from '@web-companion/spec';

export function extractData(
  config: ExtractConfig,
  root: ParentNode = document,
): unknown {
  if (config.type === 'single') {
    const el = root.querySelector(config.selector);
    if (!el) return null;
    return extractFields(el, config.fields);
  }
  const items = Array.from(root.querySelectorAll(config.selector));
  return items.map((item) => extractFields(item, config.fields));
}

function extractFields(
  parent: Element,
  fields: Record<string, FieldExtract>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, spec] of Object.entries(fields)) {
    result[key] = extractField(parent, spec);
  }
  return result;
}

function extractField(parent: Element, spec: FieldExtract): unknown {
  const source: Element | null = spec.selector
    ? parent.querySelector(spec.selector)
    : parent;
  if (!source) return null;

  switch (spec.from) {
    case 'text':
      return (source.textContent ?? '').trim();
    case 'attr':
      return source.getAttribute(spec.attr);
    case 'value':
      return source instanceof HTMLInputElement ||
        source instanceof HTMLTextAreaElement ||
        source instanceof HTMLSelectElement
        ? source.value
        : null;
    case 'checked':
      return source instanceof HTMLInputElement ? source.checked : null;
  }
}
